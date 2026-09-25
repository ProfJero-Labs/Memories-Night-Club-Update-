# Archived: the old Memories site

This folder is the previous version of the site, kept for reference only. **Don't deploy it and don't build on it.**

The live app is in [`../memories-nightclub-complete-build/memories-complete-build/`](../memories-nightclub-complete-build/memories-complete-build/).

Why it's retired:
- It wrote tickets, events and check-ins straight from the browser. The new Firestore rules block every browser write, so its admin pages no longer work against production.
- It shipped a Brevo API key and a Paystack test key in its JavaScript. Both were removed from these files, but they remain in git history: the Brevo key must be revoked in Brevo.
