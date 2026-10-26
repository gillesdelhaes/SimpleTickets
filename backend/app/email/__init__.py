"""Email channel: one connected Google Workspace mailbox (e.g. help@).

  gmail.py    OAuth connection and the few Gmail API calls we use
  parse.py    turning a raw email into text, addresses and files
  inbound.py  the poll job: new mail → tickets and replies
  outbox.py   outgoing mail: acknowledgements, technician replies, status
"""
