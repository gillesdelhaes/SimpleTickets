"""
Demo data for trying Ask: ~4 months of realistic IT helpdesk tickets.

    python -m app.demo_seed            # add the demo data
    python -m app.demo_seed --purge    # remove exactly what it added

What's in it (so Ask has real patterns to find):
  • a new SSO login rolled out 37 days ago → a spike of login-loop tickets,
    filed under three different categories
  • new-starter setup tickets scattered across Hardware / Access / Software
    (a missing "Onboarding" category)
  • an "Other" catch-all, a rarely used "Printing" category, misfiled
    tickets, a short payroll-export incident two weeks ago
  • one overloaded technician, stuck tickets, SLA breaches, reopened
    tickets, negative feedback, Monday-morning peaks

Safe on an instance with real data: nothing is sent anywhere. Seeded tickets
have no Slack thread or email thread, are marked as already triaged and
already SLA-warned, and open ones are assigned to the demo technicians, so
no job messages a requester, posts to Slack or notifies a real person.
Everything added is listed in the app setting "demo_seed" for --purge.
Labels for Ask are NOT seeded: the labelling job reads the tickets with the
configured AI provider, as it would for real tickets.
"""
import argparse
import asyncio
import json
import math
import random
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update

from app.database import AsyncSessionLocal
from app.dt import utcnow
from app.models import (
    Category, Notification, Ticket, TicketCSAT, TicketHistory, TicketReadMarker, TicketReply, User,
)
from app.models.enums import AuthProvider, Priority, Role
from app.services.settings_service import get_setting, set_setting

SEED_KEY = "demo_seed"
DAYS = 120
ROLLOUT_DAYS_AGO = 37          # the new SSO login went live
PAYROLL_INCIDENT_DAYS_AGO = 15

TECHS = [
    ("Jonas Lindqvist", "jonas.lindqvist"),
    ("Sofia Marchetti", "sofia.marchetti"),
    ("Derek Osei", "derek.osei"),
    ("Priya Raman", "priya.raman"),
]

REQUESTERS = [
    "Tomas Keller", "Ingrid Bakke", "Amara Nwosu", "Lucas Ferreira", "Hannah Schmidt", "Yuki Tanaka",
    "Mateo Rossi", "Chloé Martin", "Noah Williams", "Fatima Zahra", "Elena Petrova", "Oliver Brown",
    "Sven Andersson", "Aisha Khan", "Jakub Nowak", "Laura García", "Kenji Watanabe", "Emma Dubois",
    "Ravi Patel", "Sara Lindgren", "Ben Carter", "Zoe Müller", "Daniel Cohen", "Mia Jensen",
    "Pieter de Vries", "Nadia Haddad", "Leo Fischer", "Grace Kim", "Omar Farouk", "Julia Novak",
]

# Category names. Existing ones with the same name (any case) are reused.
HW, SW, ACCESS, NET, PRINT, OTHER = "Hardware", "Software / Applications", "Access & Permissions", "Network", "Printing", "Other"

# Each family: weekly rate (fn of days ago), where it gets filed, how it reads
FAMILIES = [
    {
        "key": "sso", "rate": lambda d: 0 if d > ROLLOUT_DAYS_AGO else (8.5 if d > 14 else 6.0),
        "cats": {ACCESS: 45, SW: 38, OTHER: 12, None: 5}, "kind_priority": {"high": 45, "medium": 45, "critical": 10},
        "hours": (6, 40), "assignee": {0: 70, 1: 15, 2: 15},
        "titles": ["CRM login loops back to SSO page", "Can't log in to payroll portal since the new login",
                   "Stuck in a redirect loop when signing in", "SSO keeps asking me to sign in again",
                   "Intranet login page refreshes forever", "Jira says session expired right after login",
                   "Login loop on the expense tool", "New sign-in page won't let me into CRM"],
        "desc": ["Since the new login page I can't get into {app}. I type my password, approve the push, and it sends me back to the sign-in page. Tried twice.",
                 "Every time I open {app} it redirects me to the company sign-in, then back, then to the sign-in again. Started this week. I have a client call in an hour.",
                 "{app} won't let me in. It loops between two pages. Incognito does the same. Colleagues next to me have the same problem."],
        "apps": ["CRM", "the payroll portal", "the intranet", "Jira", "the expense tool"],
        "fixes": ["Cleared the stale session cookies for the old login domain and it works now.",
                  "Re-registered your MFA device; the old one was still linked to the previous login.",
                  "This was the session cookie from the old sign-in. Cleared it on your laptop and you're in."],
    },
    {
        "key": "password", "rate": lambda d: 3.0,
        "cats": {ACCESS: 85, OTHER: 10, None: 5}, "kind_priority": {"medium": 60, "high": 30, "low": 10},
        "hours": (0.5, 4),
        "titles": ["Account locked out", "Forgot my password", "Password expired, can't change it",
                   "Locked out after too many attempts", "Need a password reset"],
        "desc": ["I'm locked out of my account after typing the wrong password a few times. Can you unlock it?",
                 "My password expired over the weekend and the change page gives an error.",
                 "Forgot my password after holiday, please reset."],
        "fixes": ["Unlocked the account and sent a reset link.", "Reset the password; please change it at first login."],
    },
    {
        "key": "starter", "rate": lambda d: 2.6,
        "cats": {HW: 40, ACCESS: 33, SW: 20, OTHER: 7}, "kind_priority": {"medium": 70, "high": 25, "low": 5},
        "hours": (24, 120), "monday": True,
        "titles": ["New starter kit for {n} engineers", "Laptop and accounts for new hire starting Monday",
                   "Onboarding: new designer joining on the 3rd", "Set up accounts for a new team member",
                   "New joiner needs laptop, badge and email", "Equipment for intern starting next week"],
        "desc": ["We have a new person joining {team} on {date}. They need a laptop, email, Slack and access to the shared drive.",
                 "Please prepare everything for a new starter in {team}: laptop, monitor, accounts. Start date {date}.",
                 "New hire starting {date} in {team}. Same setup as the rest of the team please."],
        "teams": ["Engineering", "Design", "Finance", "Sales", "Marketing", "Customer Success"],
        "fixes": ["Laptop imaged, accounts created and handed over on day one.",
                  "Everything set up: laptop, email, Slack and shared drive access."],
    },
    {
        "key": "leaver", "rate": lambda d: 0.8,
        "cats": {ACCESS: 55, OTHER: 35, HW: 10}, "kind_priority": {"medium": 80, "low": 20},
        "hours": (24, 96),
        "titles": ["Leaver: please disable accounts on Friday", "Offboarding for a team member leaving",
                   "Collect laptop and remove access for leaver"],
        "desc": ["Someone in {team} leaves on {date}. Please disable their accounts and collect the laptop."],
        "teams": ["Engineering", "Sales", "Finance"],
        "fixes": ["Accounts disabled at end of day and laptop collected."],
    },
    {
        "key": "thermal", "rate": lambda d: 0.6 if d > 70 else 1.7,
        "cats": {HW: 92, OTHER: 8}, "kind_priority": {"high": 50, "medium": 40, "critical": 10},
        "hours": (24, 160),
        "titles": ["Laptop fan grinding noise, thermal shutdowns", "Laptop gets very hot and shuts down",
                   "Fan constantly running at full speed", "Laptop overheating during video calls"],
        "desc": ["My laptop (the 14\" from the spring order) gets very hot and switched itself off twice today during calls. The fan sounds like it's grinding.",
                 "Fan runs at full speed all the time and the laptop shuts down when I'm on Teams."],
        "fixes": ["Replaced the fan under warranty.", "Swapped the laptop; sent the old one for a warranty repair."],
    },
    {
        "key": "boot", "rate": lambda d: 1.3,
        "cats": {HW: 90, OTHER: 10}, "kind_priority": {"high": 60, "medium": 35, "critical": 5},
        "hours": (4, 48),
        "titles": ["Laptop won't turn on", "Battery drains in an hour", "Black screen after update",
                   "Laptop stuck on boot logo"],
        "desc": ["My laptop won't boot this morning. The light comes on but the screen stays black.",
                 "The battery goes from full to empty in about an hour."],
        "fixes": ["Battery replaced.", "Repaired the boot partition after the failed update."],
    },
    {
        "key": "dock", "rate": lambda d: 1.2,
        "cats": {HW: 65, SW: 30, OTHER: 5}, "kind_priority": {"medium": 70, "low": 30},
        "hours": (8, 72),
        "titles": ["Monitor flickers when docked", "External screen not detected on the dock",
                   "Second monitor goes black every few minutes", "Dock stopped charging laptop"],
        "desc": ["When I plug into the dock my external monitor flickers every few seconds. Without the dock it's fine.",
                 "The dock doesn't detect my second screen anymore since last week."],
        "fixes": ["Swapped the dock cable for a certified one.", "Updated the dock firmware."],
    },
    {
        "key": "vpn", "rate": lambda d: 2.0,
        "cats": {NET: 50, OTHER: 30, SW: 20}, "kind_priority": {"medium": 55, "high": 40, "low": 5},
        "hours": (4, 72),
        "titles": ["VPN drops every 20 minutes", "Can't connect to VPN from home", "VPN disconnects during calls",
                   "VPN client says certificate expired"],
        "desc": ["Working from home and the VPN disconnects every 20 minutes or so. I have to reconnect each time.",
                 "VPN won't connect, it says the certificate is not valid."],
        "fixes": ["Pushed the new VPN profile to your laptop.", "Renewed the VPN certificate.",
                  "Pushed the new VPN profile; the old one used the retired gateway."],
    },
    {
        "key": "wifi", "rate": lambda d: 0.9,
        "cats": {NET: 85, OTHER: 15}, "kind_priority": {"medium": 70, "low": 30},
        "hours": (4, 48),
        "titles": ["Wi-Fi keeps dropping on the 3rd floor", "Guest Wi-Fi not working in meeting room",
                   "Slow Wi-Fi in the east wing"],
        "desc": ["The Wi-Fi on the 3rd floor near the kitchen drops every few minutes."],
        "fixes": ["Replaced the access point on the 3rd floor."],
    },
    {
        "key": "install", "rate": lambda d: 3.0,
        "cats": {SW: 88, OTHER: 7, None: 5}, "kind_priority": {"low": 55, "medium": 45},
        "hours": (2, 48),
        "titles": ["Please install {sw}", "Need a {sw} licence", "Request: {sw} for the team",
                   "Can I get {sw} on my laptop?"],
        "desc": ["Could you install {sw} on my laptop? I need it for a project starting next week.",
                 "Our team needs {sw} licences, 3 seats please."],
        "software": ["Figma", "Visual Studio", "Adobe Acrobat Pro", "Tableau", "Postman", "Miro"],
        "fixes": ["Installed through the software portal.", "Licence assigned and installed."],
    },
    {
        "key": "outlook", "rate": lambda d: 2.0,
        "cats": {SW: 80, OTHER: 20}, "kind_priority": {"medium": 70, "low": 20, "high": 10},
        "hours": (2, 48),
        "titles": ["Outlook keeps asking for my password", "Teams calendar not syncing with Outlook",
                   "Shared mailbox not showing in Outlook", "Meeting invites arrive twice"],
        "desc": ["Outlook asks for my password every hour since yesterday.",
                 "My Teams calendar doesn't show the meetings I accept in Outlook."],
        "fixes": ["Rebuilt the Outlook profile.", "Re-added the shared mailbox permissions."],
    },
    {
        "key": "printer", "rate": lambda d: 0.55,
        "cats": {PRINT: 65, HW: 35}, "kind_priority": {"low": 60, "medium": 40},
        "hours": (4, 72),
        "titles": ["Can't print to the 3rd floor printer", "Scanner doesn't send to email", "Printer jammed again"],
        "desc": ["The printer on the 3rd floor shows offline for everyone."],
        "fixes": ["Restarted the print server queue.", "Cleared the jam and replaced the roller."],
    },
    {
        "key": "access", "rate": lambda d: 2.2,
        "cats": {ACCESS: 80, OTHER: 15, SW: 5}, "kind_priority": {"medium": 60, "low": 40},
        "hours": (2, 30),
        "titles": ["Access to the Finance shared drive", "Please add me to the Marketing Drive folder",
                   "Need admin rights on Jira project", "Access to the sales dashboard"],
        "desc": ["Could I get access to the {team} shared drive? My manager approved it.",
                 "I need edit rights on the {team} folder for the quarterly report."],
        "teams": ["Finance", "Marketing", "Sales", "HR"],
        "fixes": ["Access granted after manager approval.", "Added to the group; access works now."],
    },
    {
        "key": "payroll", "rate": lambda d: 14.0 if PAYROLL_INCIDENT_DAYS_AGO - 3 <= d <= PAYROLL_INCIDENT_DAYS_AGO else 0,
        "cats": {SW: 75, OTHER: 25}, "kind_priority": {"high": 60, "critical": 40},
        "hours": (10, 30),
        "titles": ["Payroll export fails with timeout since upgrade", "Payroll report won't export",
                   "Timeout when exporting salaries"],
        "desc": ["The payroll export times out after the upgrade. We need it for the monthly run."],
        "fixes": ["Added the missing database index after the upgrade; exports work again."],
    },
    {
        "key": "howto", "rate": lambda d: 1.6,
        "cats": {OTHER: 60, SW: 40}, "kind_priority": {"low": 90, "medium": 10},
        "hours": (1, 24),
        "titles": ["How do I set an out-of-office?", "How to share my calendar with my team?",
                   "How do I book a meeting room in Outlook?", "Where can I find the VPN guide?"],
        "desc": ["Quick question: how do I do this? Couldn't find it on the intranet."],
        "fixes": ["Sent the how-to guide from the intranet."],
    },
    {
        "key": "phishing", "rate": lambda d: 1.0,
        "cats": {OTHER: 70, ACCESS: 30}, "kind_priority": {"high": 60, "medium": 40},
        "hours": (1, 8),
        "titles": ["Suspicious email asking for my password", "Got a phishing email pretending to be HR",
                   "Clicked a link in a strange email"],
        "desc": ["I got an email that looks like it's from HR asking me to log in to see my bonus. Looks fake."],
        "fixes": ["Blocked the sender and removed the email from all mailboxes."],
    },
    {
        "key": "mobile", "rate": lambda d: 0.8,
        "cats": {HW: 50, OTHER: 50}, "kind_priority": {"medium": 60, "low": 40},
        "hours": (4, 72),
        "titles": ["Can't enrol my phone in the company app", "Work email stopped on my phone",
                   "New phone: need to set up work apps"],
        "desc": ["Trying to set up work email on my new phone but the enrolment fails."],
        "fixes": ["Re-sent the enrolment invite and it worked."],
    },
]

SLA_HOURS = {"critical": 4, "high": 8, "medium": 24, "low": 72}
FR_HOURS = {"critical": 0.5, "high": 1, "medium": 4, "low": 8}


def _pick(rng: random.Random, weights: dict):
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def _created_at(rng: random.Random, day: datetime, monday_heavy: bool) -> datetime:
    hour = rng.choices(range(24), weights=[0, 0, 0, 0, 0, 1, 2, 6, 10, 10, 9, 8, 6, 8, 8, 7, 6, 4, 2, 1, 1, 0, 0, 0])[0]
    if monday_heavy and day.weekday() == 0:
        hour = rng.choice([7, 8, 8, 9, 9, 10])
    return day.replace(hour=hour, minute=rng.randrange(60), second=rng.randrange(60))


def _fill(rng: random.Random, text: str, fam: dict) -> str:
    start = utcnow() + timedelta(days=rng.randrange(2, 20))
    return text.format(
        app=rng.choice(fam.get("apps", ["it"])), team=rng.choice(fam.get("teams", ["the team"])),
        sw=rng.choice(fam.get("software", ["the app"])), n=rng.choice([2, 3]),
        date=start.strftime("%-d %b"),
    )


async def _category_ids(session, created: list[int]) -> dict[str, int]:
    out = {}
    for name in (HW, SW, ACCESS, NET, PRINT, OTHER):
        cat = (await session.execute(select(Category).where(func.lower(Category.name) == name.lower()))).scalars().first()
        if cat is None:
            cat = Category(name=name)
            session.add(cat)
            await session.flush()
            created.append(cat.id)
        out[name] = cat.id
    return out


async def seed() -> None:
    rng = random.Random(42)
    async with AsyncSessionLocal() as session:
        if await get_setting(SEED_KEY, session):
            print("Demo data is already there. Run with --purge first to start over.")
            return
        created_cats: list[int] = []
        cats = await _category_ids(session, created_cats)

        techs = []
        for name, handle in TECHS:
            email = f"{handle}@demo.simpletickets.invalid"
            user = (await session.execute(select(User).where(User.email == email))).scalars().first()
            if user is None:
                # No password and a non-routable address: these can't sign in
                user = User(email=email, name=name, role=Role.technician, auth_provider=AuthProvider.local,
                            hashed_password=None, is_active=True)
                session.add(user)
                await session.flush()
            techs.append(user)
        statuses_open = ["open", "in_progress", "pending_user"]

        now = utcnow()
        start_day = (now - timedelta(days=DAYS)).replace(hour=0, minute=0, second=0, microsecond=0)
        ticket_ids: list[int] = []
        made = 0
        for offset in range(DAYS + 1):
            day = start_day + timedelta(days=offset)
            days_ago = (now - day).days
            weekend = day.weekday() >= 5
            for fam in FAMILIES:
                # Slow growth over the period (+15%), weekends quiet
                per_day = fam["rate"](days_ago) / 5 * (1 + 0.15 * (DAYS - days_ago) / DAYS)
                if fam.get("monday") and day.weekday() == 0:
                    per_day *= 2.2
                if weekend:
                    per_day *= 0.08
                count = _poisson(rng, per_day)
                for _ in range(count):
                    created = _created_at(rng, day, fam.get("monday", False))
                    if created > now - timedelta(minutes=30):
                        continue
                    tid = await _make_ticket(session, rng, fam, created, now, cats, techs, statuses_open)
                    ticket_ids.append(tid)
                    made += 1
            if offset % 20 == 0:
                await session.flush()

        await set_setting(SEED_KEY, json.dumps({
            "tickets": ticket_ids, "users": [t.id for t in techs], "categories": created_cats,
            "created_at": now.isoformat(),
        }), session)
        await session.commit()
    print(f"Added {made} demo tickets over {DAYS} days, {len(TECHS)} demo technicians, "
          f"{len(created_cats)} new categories. The labelling job will now read them (needs the AI assistant on).")


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


async def _make_ticket(session, rng, fam, created, now, cats, techs, statuses_open) -> int:
    priority = _pick(rng, fam["kind_priority"])
    cat_name = _pick(rng, fam["cats"])
    title = _fill(rng, rng.choice(fam["titles"]), fam)
    desc = _fill(rng, rng.choice(fam["desc"]), fam)
    requester = rng.choice(REQUESTERS)
    source = rng.choices(["slack", "email", "web"], weights=[60, 30, 10])[0]
    assignee = techs[_pick(rng, fam.get("assignee", {0: 25, 1: 28, 2: 25, 3: 22}))]

    lo, hi = fam["hours"]
    # Log-uniform resolve time; the SSO tickets waited on the vendor at first
    resolve_h = math.exp(rng.uniform(math.log(lo), math.log(hi)))
    if fam["key"] == "sso" and (now - created).days > 20:
        resolve_h *= 1.8
    fr_h = math.exp(rng.uniform(math.log(0.1), math.log(3.5)))
    if fam["key"] == "sso" or (now - created).days < 40:
        fr_h *= 1.6  # the team got busier
    first_response = created + timedelta(hours=fr_h)
    resolved = created + timedelta(hours=resolve_h)
    stuck = rng.random() < 0.04 and (now - created).days > 6
    is_open = resolved > now or stuck

    if is_open:
        status = rng.choice(statuses_open) if not stuck else rng.choice(["in_progress", "pending_user"])
        resolved_at = None
    elif resolved > now - timedelta(days=2):
        status, resolved_at = "resolved", resolved
    else:
        status, resolved_at = "closed", resolved

    sla_deadline = created + timedelta(hours=SLA_HOURS[priority])
    fr_deadline = created + timedelta(hours=FR_HOURS[priority])
    breached = (resolved_at or now) > sla_deadline
    if first_response > now:
        first_response = None
    # Stuck tickets haven't moved since the first response
    updated = resolved_at or first_response or created

    t = Ticket(
        title=title[:200], description=desc, status=status, priority=Priority(priority),
        category_id=cats[cat_name] if cat_name else None, assignee_id=assignee.id, source=source,
        slack_submitter_name=requester if source == "slack" else None,
        email_requester=f"{requester.lower().replace(' ', '.')}@example.com" if source == "email" else None,
        sla_deadline=sla_deadline, sla_breached=breached, first_response_deadline=fr_deadline,
        first_responded_at=first_response,
        # Never warned about, never triaged: no job acts on demo tickets
        sla_breach_warned_at=created, first_response_warned_at=created,
        # Triaged "now" (after every seeded message) and out of question
        # rounds: the Assistant never re-reads or writes to demo requesters
        ai_triaged_at=now, ai_runs=1, ai_question_rounds=3,
        created_at=created, updated_at=updated, resolved_at=resolved_at,
    )
    if rng.random() < 0.55:
        suggested = cat_name if rng.random() < 0.82 else rng.choice([HW, SW, ACCESS, NET, OTHER])
        t.ai_assessment = json.dumps({"assessment": {
            "clarity": "clear", "summary": title, "known": [], "missing": [], "possible_fixes": [],
            "questions_intro": "", "questions": [], "questions_outro": "",
            "suggested_priority": priority, "priority_reason": "", "suggested_category": suggested,
            "category_reason": "", "suggested_title": None,
        }, "asked": [], "last_asked": [], "category_set": None, "priority_set": None, "title_set": None})
    session.add(t)
    await session.flush()

    # Conversation and history
    tech = assignee
    hist = [(created, None, "status", None, "open")]
    if first_response:
        session.add(TicketReply(ticket_id=t.id, author_id=tech.id, body=rng.choice([
            "Thanks, looking into it now.", "On it. Can you tell me when this started?",
            "Thanks for reporting. I'll check and get back to you shortly.",
        ]), created_at=first_response))
        hist.append((first_response, tech.id, "status", "open", "in_progress"))
        if rng.random() < 0.5:
            session.add(TicketReply(ticket_id=t.id, author_id=None, slack_author_name=requester, body=rng.choice([
                "It started yesterday afternoon.", "Still happening this morning.", "Thanks! It's quite urgent.",
                "Same thing on my second laptop.",
            ]), created_at=first_response + timedelta(minutes=rng.randrange(10, 180))))
    if resolved_at:
        fix = rng.choice(fam["fixes"])
        session.add(TicketReply(ticket_id=t.id, author_id=tech.id, body=fix + " Let me know if it comes back.",
                                created_at=resolved_at - timedelta(minutes=2)))
        # A few were reopened once
        if rng.random() < 0.05 and resolve_h > 6:
            first_close = created + timedelta(hours=resolve_h * 0.4)
            hist.append((first_close, tech.id, "status", "in_progress", "resolved"))
            hist.append((first_close + timedelta(hours=resolve_h * 0.2), None, "status", "resolved", "in_progress"))
        hist.append((resolved_at, tech.id, "status", "in_progress", "resolved"))
        if status == "closed":
            hist.append((resolved_at + timedelta(days=2), None, "status", "resolved", "closed"))
        # Satisfaction
        if rng.random() < 0.45:
            happy = 0.9 - (0.25 if fam["key"] in ("sso", "payroll") else 0) - (0.2 if breached else 0)
            session.add(TicketCSAT(ticket_id=t.id, score=rng.random() < happy,
                                   responded_at=resolved_at + timedelta(hours=rng.randrange(1, 30))))
    for at, actor, field, old, new in hist:
        if field == "status" and old is None:
            continue  # creation isn't a status change
        session.add(TicketHistory(ticket_id=t.id, actor_id=actor, field_changed=field,
                                  old_value=old, new_value=new, created_at=at))
    return t.id


async def purge() -> None:
    from app.models.insight import TicketInsight
    async with AsyncSessionLocal() as session:
        raw = await get_setting(SEED_KEY, session)
        if not raw:
            print("No demo data recorded; nothing to remove.")
            return
        info = json.loads(raw)
        ids = info.get("tickets", [])
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            for model in (TicketInsight, TicketReply, TicketHistory, TicketCSAT, TicketReadMarker, Notification):
                await session.execute(delete(model).where(model.ticket_id.in_(chunk)))
            await session.execute(update(Ticket).where(Ticket.duplicate_of_id.in_(chunk)).values(duplicate_of_id=None))
            await session.execute(delete(Ticket).where(Ticket.id.in_(chunk)))
        users = info.get("users", [])
        if users:
            await session.execute(update(Ticket).where(Ticket.assignee_id.in_(users)).values(assignee_id=None))
            await session.execute(delete(Notification).where(Notification.user_id.in_(users)))
            await session.execute(delete(User).where(User.id.in_(users)))
        for cid in info.get("categories", []):
            still_used = (await session.execute(select(func.count()).where(Ticket.category_id == cid))).scalar()
            if still_used:
                await session.execute(update(Category).where(Category.id == cid).values(is_archived=True))
            else:
                await session.execute(delete(Category).where(Category.id == cid))
        await set_setting(SEED_KEY, "", session)
        await session.commit()
    print(f"Removed {len(ids)} demo tickets and {len(users)} demo technicians.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add or remove Ask demo data")
    parser.add_argument("--purge", action="store_true", help="remove the demo data this script added")
    args = parser.parse_args()
    asyncio.run(purge() if args.purge else seed())
