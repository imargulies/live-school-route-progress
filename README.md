# Route Progress — Complete Guide to How Statuses Are Decided

A reference document for dispatchers, administrators, and anyone auditing why a bus appears the way it does on the live board.

---

## 1. The big picture

Every few seconds, each bus reports its GPS position. We compare that position to the school zone you drew on the map. As positions come in over time, we build up a picture of what the bus did during each route window:

- Was it at school when the route started?
- Did it actually drive across the boundary?
- Did it park, or was it just passing through?
- Did it leave, and stay gone?

We only change a bus's status when we have **real, sustained evidence** — not GPS jitter, not a drive-through, not yesterday's leftover data.

The system is deliberately conservative. Given a choice between a false "Arrived" and waiting another 30 seconds to confirm, it waits.

---

## 2. The seven possible states

| Status | Meaning | Color |
|---|---|---|
| **Waiting** | The route window has not started yet. | grey |
| **Arrived** | The bus drove into the zone and parked. | green |
| **Not Arrived** | The window is open (or ended) but no arrival has been recorded. | red |
| **Departed** | The bus was at school and actually left. | green |
| **Not Departed** | The window is open (or ended) but the bus has not left yet. | red |
| **No Data** | No GPS logs found in the window. | grey |
| **No-show** | The window ended with no event recorded. | red |

Under the status badge, each row also shows a short target-comparison line (see §5).

---

## 3. How "Arrived" is decided

For a row to flip to **Arrived**, all three rules must hold:

### Rule 1 — Bus was observed OUTSIDE the zone at some point during the window
The bus has to have actually driven in from outside. A bus that was parked at school for the whole window (stayed overnight, garaged on-site, etc.) without ever leaving is not "arriving" — it's already there. If we never see an out-of-zone log, no arrival will be recorded.

Note that the bus doesn't have to be outside *at route start*. A bus that starts the route window already inside the zone, then leaves, then comes back and parks, still counts as arrived — the mid-window out-observation is enough.

### Rule 2 — Bus drove into the zone during the window
We need at least one in-zone GPS log following an out-of-zone log during the window — i.e., we have to see the actual crossing inward.

### Rule 3 — Bus stayed inside the zone for at least 60 seconds
A drive-through (delivery truck cutting across the school parking lot) is not an arrival. The bus must be **inside the zone continuously for 60 seconds** — moving or stopped, doesn't matter. If it leaves the zone before the 60-second mark, the clock resets.

The 60-second gate (instead of "stopped for 30 seconds") is what makes **Arrived At** reflect the moment the bus actually entered the school zone, not the moment it eventually parked. Schools with large grounds and long parking-lot loops would otherwise show arrivals 5–20 minutes after the bus actually got there.

When all three hold, **Arrived At** is set to the moment the bus first crossed into the zone (the start of the 60-second in-zone dwell), not the moment the 60 seconds expired.

---

## 4. How "Departed" is decided

For a row to flip to **Departed**, all three rules must hold:

### Rule 1 — The bus was at school at some point
Either:
- It was **inside the zone at route start** (parked from earlier, overnight, prior run, etc.), or
- It was **observed inside the zone** at any point during the window (including a brief pickup of just a few seconds — afternoon pickups don't always involve a full stop).

A bus that never entered the zone at all during the window can't depart it.

### Rule 2 — Bus drove out of the zone
There must be at least one in-zone and one out-of-zone GPS log in sequence.

### Rule 3 — Bus stayed out for at least 30 seconds
A one-ping GPS wobble at the edge of the school zone does not count as a departure. The bus must be outside the zone continuously for 30 seconds. If it re-enters before the 30-second mark, the pending departure is discarded and we start over.

When all three hold, **Departed At** is the moment the bus first crossed out of the zone for that sustained leave — coming from the GPS log, not from Geotab's "trip start" timestamp (which fires when the key is turned, often minutes before the bus actually moves).

---

## 4b. Events are sticky for the rest of the day

Once **Arrived At** or **Departed At** has been committed for a given row on a given day, it stays committed for the rest of that day even if the bus's subsequent movement would have caused a different answer. For example:

- Bus parks at school at **4:30 PM**, the row flips to **Arrived: 4:30 PM**.
- Bus briefly pulls out of the zone at **4:45 PM** (driver moved up one spot in the line).
- Row does **not** flip back to Not Arrived. It stays Arrived: 4:30 PM.
- Bus parks again, nothing changes.

Same rule for Departures. This prevents a confusing flicker where a row bounces between Departed and Not Departed as the bus moves around the zone edge. Switching the date picker or clicking **Refresh** re-evaluates from scratch (sticky memory is wiped when the page does a full render).

---

## 5. Target comparison — how the subline is chosen

Each route can have a **target window** inside the broader route window, plus a **grace** in minutes. Example:

- Route window: 7:55 AM – 8:45 AM (when we track)
- Target window: 8:05 AM – 8:25 AM (when the bus *should* arrive)
- Grace: 2 minutes (tolerance on each side)

When we have a real event time for the row, we compare it to the target (with grace applied):

| Event time lands… | Subline |
|---|---|
| inside `[target start − grace, target end + grace]` | **On target time** (green) |
| after `target end + grace` | **Late: Nm from target** (red) |
| before `target start − grace` | **Early: Nm from target** (orange) |

If we have no event yet:

| Situation | Subline |
|---|---|
| Target time passed, window still open, no event yet | **Late: Nm from target** (overdue; red) |
| Route window fully ended and no event at all | **No-show** (red) |
| Window still open but target not yet reached | **Pending** |

The subline sits directly under the Arrived/Departed chip so you see both "what state" and "how it compares to target" at one glance. The dedicated vs-Target cell carries the same information plus helpful context (e.g., "17 min to Route end").

---

## 6. How "Distance" is measured

Straight-line (great-circle) distance in kilometres from the bus's current GPS position to the nearest edge of the school zone polygon. We compute and show it for every row — pickup routes and drop-off routes alike — so you can see at a glance how close the bus is.

---

## 7. Trip-based enrichments (a second source of truth)

The logs above are the primary signal. We also look at Geotab's **Trip** records, which describe stops and starts. Two cases where Trips fill in gaps:

- **Trip ended inside the zone during the window** → counted as an arrival at the stop time (not clamped to window start — if the stop happened before the window opened, the bus never "arrived" during this window).
- **Trip started inside the zone during the window** → counted as a departure at the start time (the engine came on and the bus drove off from within the zone).

Both paths respect the same "at route start" rules. A bus parked at school from last night that starts a trip during the morning window correctly shows **Departed**, not "Departed before Arrived" or any other confusion.

---

## 8. Why 30 seconds?

GPS pings are noisy. Without a small patience window, two kinds of false alarms would happen constantly:

- **Drive-throughs** — a bus that cuts through the school parking lot without stopping would flash "Arrived" for 2 seconds and then "Departed" right after. Dispatchers see nonsense.
- **GPS wobble** — at the edge of any zone polygon, GPS error can make the bus jitter between in and out for 5–10 seconds even though it hasn't actually moved. Without dwell, the status would flip back and forth.

30 seconds of **sustained in-zone-stopped** (for arrivals) or **sustained out-of-zone** (for departures) is enough to filter both. This is tuned based on Geotab's standard GPS sampling rate and typical bus behavior at pickup/drop-off.

---

## 9. Edge cases the system handles correctly

### Bus parked at school overnight
Reads **Not Arrived** during the morning route. The Rule 1 "outside at route start" check blocks a phantom arrival. Nothing surprises anyone with a "wait, when did the bus arrive at 7:00 AM if the route started at 7:55?".

### Bus driven off-site by the night janitor or mechanic
The bus is outside at route start, so the morning route can correctly go **Arrived** when it comes back. The afternoon route's Departure logic still works because Trip data fills in the at-school state.

### Driver signed in to a different bus today
If you track the route by **driver** (not by vehicle), the "Current Vehicle" column and the Map button follow the *driver* and update to whichever bus they are actually in. GPS for the route is taken from the active vehicle for that driver, sliced by the driver's trip intervals so a shared vehicle's other-driver pings don't leak in.

### Late arrival that spills into the next route
If Route A ends at 8:45 and Route B starts at 8:46, and the bus arrived at 8:46:30, the event is re-attributed to Route A (with a 30-minute grace tail). That means you see "**Late: 2m**" on Route A instead of "**No-show**" on Route A and "**Very early**" on Route B.

### Sparse GPS (60–120 seconds between pings)
The 30-second rule is about elapsed wall-clock time between the first stopped-in-zone ping and a later one — not the sample rate. Two stopped pings 60 seconds apart still commit the arrival.

### GPS radio silence for 10+ minutes
The live tick caches logs and fetches only the delta since the last tick. If a device has been silent for more than 10 minutes, the next tick treats it as a reconnect and does a full refetch for that bus so nothing is missed.

### Routes changed while viewing
If an admin adds/edits/deletes a route in another tab, the live tick detects the change on its next cycle and re-renders the full board.

---

## 10. Summary tiles at the top

Five tiles summarize today at a glance:

| Tile | Count |
|---|---|
| **Total Vehicles** | Distinct vehicles + drivers assigned today (an entity on multiple routes counts once). |
| **On Track** | Row-assignments currently where they should be. |
| **Late / Overdue** | Row-assignments that are late vs target, or overdue with no event yet. |
| **Off Track** | Row-assignments that have explicitly failed their direction check. |
| **Waiting** | Row-assignments whose route window hasn't started or have no GPS data yet. |

The four state tiles count **assignments** (one row per vehicle-route pair). Total Vehicles deduplicates to count the underlying entities.

---

## 11. Filter behavior

- **Show only late arrivals/departures** — hides entire cards where every row is on track, AND hides the on-track rows inside cards that still have at least one problem, so the board collapses down to just what needs attention.
- **Compare last 7d avg** — shows a small subline under Compare-to-Target with the rolling 7-day average event time and variance, plus a live "vs 7d avg" indicator.
- **Notify on problems** — fires a browser notification the first time any row flips to Late or No-show during the current day; deduped per (row, day, kind) and persisted across page reloads so you don't get the same alert twice.

---

## 12. How to read the route card

Each route card has a header with the name, scheduled window, target badge, progress counts, and three action chips: **collapse/expand**, **Route Trend** (14-day on-time rate popup), and **Loading** (pulses during each refresh).

Inside, for each assigned driver or vehicle, the row columns are:

| Column | What it shows |
|---|---|
| **Driver / Vehicle** | Name, left-aligned. |
| **Current Vehicle** | Which bus the driver is in now (driver-tracked routes only). |
| **Current Location** | Street address only — city/state/zip trimmed for density. |
| **Map** | One-click link to this vehicle on Geotab's live map. |
| **Status** | The state from §2, plus target-comparison subline from §5. |
| **Arrived/Departed At** | Exact event time, with "(h m ago)" relative stamp. |
| **Compare to Target** | Late/Early minutes with "to Route end" context, plus optional 7-day-avg subline. |
| **14 Day Trend** | Click to open a popup showing this driver/vehicle's history for this route. |
| **Time at Zone / Time Away** | Minutes in the zone vs minutes elapsed so far. |
| **Distance** | Kilometers from the zone right now. |
| **Engine** | On + km/h, or Stopped, or "No signal" after 15 min stale. |
