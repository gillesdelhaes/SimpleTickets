"""
Turn a raw RFC 822 email into what a ticket needs: who, subject, readable
text and files. Everything here is untrusted input — keep it to the
standard library's parser and treat every field as plain text.
"""
import base64
import re
from dataclasses import dataclass, field
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr
from html.parser import HTMLParser
from typing import Optional

MAX_BODY_CHARS = 20_000
MAX_FILE_BYTES = 10 * 1024 * 1024
_MSGID = re.compile(r"<[^<>\s]+>")
_TICKET_TAG = re.compile(r"\[TKT-0*(\d{1,9})\]", re.I)
_SUBJECT_PREFIX = re.compile(r"^\s*((re|fw|fwd|aw|tr|sv)\s*(\[\d+\])?\s*:\s*)+", re.I)


@dataclass
class ParsedFile:
    filename: str
    content: bytes


@dataclass
class ParsedEmail:
    message_id: Optional[str]
    from_name: str
    from_address: str
    to: list[str]
    cc: list[str]
    subject: str
    in_reply_to: list[str]
    references: list[str]
    text: str
    files: list[ParsedFile] = field(default_factory=list)
    # Why this message should not be ticketed (auto-reply, bounce, bulk), or None
    automated: Optional[str] = None
    # The sender's domain failed DMARC per Google's own check: likely spoofed
    dmarc_failed: bool = False

    @property
    def ticket_number(self) -> Optional[int]:
        m = _TICKET_TAG.search(self.subject)
        return int(m.group(1)) if m else None

    @property
    def clean_subject(self) -> str:
        s = _TICKET_TAG.sub("", self.subject)
        return re.sub(r"\s+", " ", _SUBJECT_PREFIX.sub("", s)).strip()


def parse_raw(raw_b64url: str) -> ParsedEmail:
    data = base64.urlsafe_b64decode(raw_b64url + "=" * (-len(raw_b64url) % 4))
    msg: EmailMessage = BytesParser(policy=policy.default).parsebytes(data)  # type: ignore[assignment]

    from_name, from_addr = parseaddr(str(msg.get("From", "")))
    return ParsedEmail(
        message_id=_first_msgid(msg.get("Message-ID")),
        from_name=_one_line(from_name)[:200],
        from_address=from_addr.strip().lower(),
        to=_addresses(msg, "To"),
        cc=_addresses(msg, "Cc"),
        subject=_one_line(str(msg.get("Subject", "") or ""))[:255],
        in_reply_to=_MSGID.findall(str(msg.get("In-Reply-To", "") or "")),
        references=_MSGID.findall(str(msg.get("References", "") or ""))[-50:],
        text=_body_text(msg),
        files=_files(msg),
        automated=_automated_reason(msg, from_addr.lower()),
        dmarc_failed=_dmarc_failed(msg),
    )


def _one_line(s: str) -> str:
    return re.sub(r"[\r\n\t]+", " ", s).strip()


def _first_msgid(value) -> Optional[str]:
    if not value:
        return None
    m = _MSGID.search(str(value))
    return m.group(0)[:500] if m else None


def _addresses(msg: EmailMessage, header: str) -> list[str]:
    values = [str(v) for v in msg.get_all(header, [])]
    return [a.strip().lower() for _, a in getaddresses(values) if "@" in a][:50]


def _automated_reason(msg: EmailMessage, from_addr: str) -> Optional[str]:
    auto = str(msg.get("Auto-Submitted", "")).strip().lower()
    if auto and auto != "no":
        return "auto-submitted"
    if str(msg.get("Precedence", "")).strip().lower() in ("bulk", "junk", "list", "auto_reply"):
        return "bulk"
    if msg.get("X-Autoreply") or msg.get("X-Autorespond") or msg.get("X-Auto-Response-Suppress", "").lower() in ("all", "oof"):
        return "auto-reply"
    if msg.get("List-Id") or msg.get("List-Unsubscribe"):
        return "mailing list"
    local = from_addr.split("@")[0]
    if local in ("mailer-daemon", "postmaster") or local.startswith(("no-reply", "noreply", "do-not-reply", "donotreply")):
        return "no-reply sender"
    if msg.get_content_type() == "multipart/report":
        return "delivery report"
    return None


def _dmarc_failed(msg: EmailMessage) -> bool:
    # Gmail adds this header itself; take only the first (topmost) one, which
    # is Google's — anything below it could have been written by the sender.
    first = msg.get("Authentication-Results")
    return bool(first and re.search(r"\bdmarc=fail\b", str(first), re.I))


# ── Body ──────────────────────────────────────────────────────────────────────


def _body_text(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except (LookupError, ValueError):
        payload = part.get_payload(decode=True) or b""
        content = payload.decode("utf-8", errors="replace")
    if not isinstance(content, str):
        return ""
    if part.get_content_type() == "text/html":
        content = html_to_text(content)
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    content = re.sub(r"\n{3,}", "\n\n", content).strip()
    return content[:MAX_BODY_CHARS]


class _TextExtractor(HTMLParser):
    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "ul", "ol"}
    _SKIP = {"script", "style", "head", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip = 0
        self._marked = False

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip += 1
        # Gmail/Outlook wrap the quoted history in these — mark it so reply
        # cleaning can cut there
        cls = dict(attrs).get("class") or ""
        if not self._marked and (tag == "blockquote" or "gmail_quote" in cls):
            self.out.append("\n" + _QUOTE_MARKER + "\n")
            self._marked = True
        if tag in self._BLOCK:
            self.out.append("\n")
        if tag == "li":
            self.out.append("• ")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip:
            self._skip -= 1
        if tag in self._BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.out.append(re.sub(r"[ \t\r\n]+", " ", data))


def html_to_text(html: str) -> str:
    p = _TextExtractor()
    try:
        p.feed(html[:500_000])
        p.close()
    except Exception:  # noqa: BLE001 — malformed HTML: keep what we got
        pass
    lines = [ln.strip() for ln in "".join(p.out).split("\n")]
    return "\n".join(lines)


_QUOTE_MARKER = "⁣QUOTE⁣"
_QUOTE_HEADERS = [
    re.compile(r"^On .{5,300}wrote:\s*$", re.I),
    re.compile(r"^Le .{5,300}a écrit\s*:\s*$", re.I),
    re.compile(r"^Am .{5,300}schrieb .{0,200}:\s*$", re.I),
    re.compile(r"^Op .{5,300}schreef .{0,200}:\s*$", re.I),
    re.compile(r"^-{2,}\s*(Original Message|Message d'origine|Ursprüngliche Nachricht)\s*-{2,}", re.I),
    re.compile(r"^_{10,}\s*$"),
    re.compile(r"^(From|De|Von|Van)\s*:\s.+", re.I),
]


def strip_quoted(text: str) -> str:
    """Drop the quoted history and signature from a reply, keeping what the
    person actually wrote. Falls back to the full text if nothing is left."""
    lines = text.split("\n")
    cut = len(lines)
    for i, line in enumerate(lines):
        s = line.strip()
        if s == _QUOTE_MARKER:
            cut = i
            break
        # Gmail wraps long "On … wrote:" lines in two
        joined = s + " " + lines[i + 1].strip() if i + 1 < len(lines) else s
        if any(p.match(s) for p in _QUOTE_HEADERS) or (s.startswith("On ") and _QUOTE_HEADERS[0].match(joined)):
            cut = i
            break
        if s.startswith(">") and all(not ln.strip() or ln.strip().startswith(">") for ln in lines[i:]):
            cut = i
            break
    kept = lines[:cut]
    # Signature delimiter ("-- ")
    for i, line in enumerate(kept):
        if line.rstrip("\n") in ("-- ", "--"):
            kept = kept[:i]
            break
    result = "\n".join(kept).strip()
    return result or remove_marker(text).strip()


def remove_marker(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.replace(_QUOTE_MARKER, "")).strip()


# ── Files ─────────────────────────────────────────────────────────────────────


def _files(msg: EmailMessage) -> list[ParsedFile]:
    out: list[ParsedFile] = []
    body = msg.get_body(preferencelist=("plain", "html"))
    for part in msg.walk():
        if part.is_multipart() or part is body:
            continue
        filename = part.get_filename() or ""
        if not filename:
            # Inline images without a name (signature logos) are noise
            continue
        payload = part.get_payload(decode=True) or b""
        if not payload or len(payload) > MAX_FILE_BYTES:
            continue
        out.append(ParsedFile(filename=_one_line(filename)[:200], content=payload))
        if len(out) >= 10:
            break
    return out
