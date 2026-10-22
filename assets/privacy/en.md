# Privacy notice — FreeWhen

**Applies from the first event you join.** This notice is bundled with the app, so
it opens without a network connection.

---

## 1. What we collect, and what we deliberately do not

We collect:

- **A display name.** You choose it. It is visible to the people in your events.
- **An approximate starting area.** Two decimal places — roughly a 1 km square.
  It is never a precise position.
- **Your transport modes, travel budget, and access needs**, when you set them.
  These decide which venue is fair for the group.
- **Your votes, proposals, RSVPs, and comments** inside an event.

We deliberately do **not** collect: your precise GPS position, your contacts, your
address book, your device identifiers for advertising, your background location,
or your home address. There is no advertising or tracking SDK in this app.

## 2. Your location is approximate, on purpose

The device rounds your position to two decimal places **before** it leaves your
phone. The precise reading is discarded on the device and is never sent to us,
never stored, and never logged. The database itself cannot hold a third decimal
place.

If you decline the location permission, you can type your neighbourhood instead.
**Every feature still works** — joining, proposing a place, voting, and seeing the
decision. Declining location does not remove you from anything.

## 3. Who can see your starting area

Only the participants of that one event. Nobody else — not other events, not
other groups, not us in any interface.

You have two settings:

- **The participants of this event** — they see your approximate area on the map.
- **Only for distance calculation** — the area is used to work out a fair travel
  time for you, but the other participants see "location not shared".

The second setting does **not** exempt you from the fairness calculation. Your
real area still counts when the group's travel times are compared. It is hidden
from people's eyes, not from the calculation — otherwise "private" would be a way
to opt out of fairness, which would be unfair to everyone else.

## 4. How long it is kept

Your starting area is deleted **one hour after the event's date window ends**.
After that the coordinates no longer exist in our database.

What survives is the record of what the group decided — the venue, the votes and
the outcome. That is a shared history, and it does not contain your location.

Anonymous accounts with no activity are deleted after **30 days**.

## 5. Deleting your location

There is a one-tap control to delete your starting area at any time. Deleting it:

- removes the coordinates immediately and permanently;
- leaves you in the event — your votes, proposals and RSVP are untouched;
- makes the ranking say honestly that your travel time is no longer included.

It does not remove you from the group and it does not cancel your votes.

## 6. Deleting your account

In the app: **Settings → Delete my account**. This removes your account, every
event you organised, and all of your location rows. Events you merely joined
survive, because other people's plans are not yours to delete. This action cannot
be undone.

## 7. Third parties who receive your approximate area

We use three services, and we name them because sending your area to a company is
a disclosure, not an implementation detail.

| Recipient | What it receives | Why | Their retention |
|---|---|---|---|
| **Neshan** | Your approximate starting area and the venue area, to calculate travel time. Data stays in Iran. | Primary routing and search | **Unverified** — we could not confirm Neshan's retention period at a primary source. We state that plainly rather than invent an assurance. |
| **OpenRouteService** | The same rounded areas, only if Neshan is unavailable | Fallback routing | **Unverified** — their terms are behind a consent wall we could not pass. The service is self-hostable, which would remove this disclosure entirely, and we intend to. |
| **Mapbox** | The map viewport — centred on the event's area, never on one person — to draw the map tiles | Map rendering | **Unverified** — their policy page is rendered by JavaScript and could not be read. Mapbox also collects unidentified usage telemetry by default; the attribution control carries its opt-out and stays visible. |

**What they do not receive:** your name, your identity, your precise position, or
which specific person the area belongs to. They receive coordinates, not a person.

No other third party receives anything. We do not sell data. There is no
analytics provider, no crash-reporting vendor, and no advertising network.

## 8. The activity log

Each event has a log of what happened — *"Bahar changed their vote from maybe to
yes"*, *"the venue was confirmed"*. It records **actions, not locations**. There
is no coordinate in it, ever, and it is visible to the participants of the event.

## 9. What this notice does not promise

We are honest about the gaps rather than implying completeness:

- **No identity verification.** An invite link is the only credential. Anyone
  holding the link can join.
- **No blocking or reporting** between participants. There is no chat in this
  version; comments are attached to proposals and the organiser can delete them.
- **No screenshot protection.** If someone screenshots the map, nothing stops
  them. This is technically unpreventable.
- **No age verification.** The app is for adults; the store listing states 18+.
- **Organiser control is tied to the device.** Losing the device loses organiser
  control.

## 10. Your rights

You can see what we hold about you, correct it, delete your location, and delete
your account — all inside the app. If you need something the app does not offer,
contact the organiser of your event or the address in the store listing.

---

*This notice describes what the app actually does. It is not legal advice and has
not been reviewed by a lawyer. For a legal question about your situation, consult
a qualified advisor in your jurisdiction.*
