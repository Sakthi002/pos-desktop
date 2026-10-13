# Running a shop on this software

Everything a shopkeeper or whoever installed the software needs when something
goes wrong: where the data is, how to get it back, and what to send to whoever
is helping — without handing over the shop's customer list.

## Where the data is

| What               | Windows                                | Linux                                |
| ------------------ | -------------------------------------- | ------------------------------------ |
| Database           | `%APPDATA%\pos-desktop\pos.db`         | `~/.config/pos-desktop/pos.db`       |
| Write-ahead log    | `pos.db-wal`, `pos.db-shm` beside it   | same                                 |
| Logo               | `%APPDATA%\pos-desktop\assets\`        | `~/.config/pos-desktop/assets/`      |
| Pre-restore copies | `%APPDATA%\pos-desktop\pre-restore\`   | `~/.config/pos-desktop/pre-restore/` |
| Backups            | the folder chosen in Settings → Backup | same                                 |

The database never lives in the installation folder, so installing a new
version cannot overwrite it. Uninstalling does not delete it either.

**Do not copy `pos.db` by hand.** SQLite runs in WAL mode, so the newest sales
may still be in `pos.db-wal`. A copy of `pos.db` alone can be missing the last
part of the day. Use Settings → Backup, which uses SQLite's own backup API and
verifies the file it produces.

## Taking backups

Settings → **Backup & restore**.

1. Choose a folder. The app refuses a folder inside its own data directory,
   because a backup there dies with the disk it is on.
2. **Back up now** writes one self-contained file, named
   `pos-backup-YYYYMMDD-HHMMSS.db`, and checks it before reporting success.
3. Turn on automatic backups (daily or weekly). They run shortly after the app
   starts and hourly thereafter, so a day the shop stayed shut is caught at the
   next start rather than skipped.
4. **Copy backups off the machine.** A backup on the same computer protects
   against a mistake, not against the computer being stolen, dropped or
   drowned. A pen drive taken home weekly is enough.

Each backup carries the date, the app version and the schema version inside the
file, so a folder full of them is still intelligible a year later.

## Restoring

Settings → **Backup & restore** → **Restore** next to a backup, or **Restore
from a file…** for one on a pen drive.

Before anything is replaced:

- the file is checked — damaged files, files that are not this app's database,
  and backups made by a newer version are refused with a plain explanation;
- the current database is copied to `pre-restore\` first.

Restoring replaces everything in the app with the contents of the backup. Sales
recorded after that backup was taken will be gone from the app — but the
pre-restore copy still holds them, so nothing is destroyed on disk. The restore
is recorded in Settings → Audit trail.

## If the app will not start

1. **Note the message** on the "Could not start" screen before closing it.
2. Check there is free disk space. SQLite cannot write to a full disk.
3. Restart the computer. A machine that lost power mid-sale recovers on the
   next start: the interrupted sale is rolled back whole, never half-written.
4. If it still fails, rename the data folder (see the table above) to
   `pos-desktop-broken` and start the app again. It will create a new, empty
   database and run the setup wizard. Then use **Restore from a file…** with
   your most recent backup.
5. Keep `pos-desktop-broken` until the shop is sure it has everything back.

## Collecting diagnostics without exposing customer data

When reporting a problem, send:

- the exact message shown on screen, and what was being done at the time;
- the app version and schema version, both printed at the bottom of the sidebar
  (for example `v0.1.0 · schema v5`);
- the operating system and version;
- a screenshot **of the error**, not of a customer's invoice.

Do **not** send `pos.db` or a backup file. They contain every sale, every
customer name and phone number, and the shop's own GST details. A database is
only worth sending when the problem is the data itself, and then it should go
to someone the shop already trusts with that information, over a channel the
shop controls.

If a developer needs more, the app's own logs appear in the terminal only when
it is run from a terminal (`npm run dev`); a packaged build writes none, by
design — nothing is collected, and nothing is sent anywhere.

## Installing and updating on Ubuntu

```bash
sudo apt install ./Universal\ POS-0.1.1-amd64.deb     # install, or upgrade in place
sudo apt remove pos-desktop                           # remove the app, keep the data
```

The app appears in the applications menu as **Universal POS**. A newer `.deb`
installed over an older one keeps the database, the settings and the logo —
they live in `~/.config/pos-desktop`, not in `/opt`. Removing the package does
not delete that folder either; to erase a shop's data you have to delete it
yourself, deliberately.

The portable AppImage needs no installation:

```bash
chmod +x Universal\ POS-0.1.1-x86_64.AppImage
./Universal\ POS-0.1.1-x86_64.AppImage
```

It uses the same data folder as the installed package, so a shop can try one
and move to the other without losing anything. On a desktop without FUSE, add
`--appimage-extract-and-run`.

Ubuntu packages are not served from a repository, so **nothing updates itself**.
Updating is a deliberate act: download the new package and install it over the
old one. The app runs any new migrations on first start; they are forward-only
and do not rewrite existing rows.

**Take a backup before updating.** Not because an update is expected to lose
anything, but because the five minutes it costs is the cheapest insurance in
the shop.

## The packages are not signed

Neither the Ubuntu packages nor the planned Windows installer are signed. That
has consequences a shop should be told about rather than discover:

- On Windows, SmartScreen will show "Windows protected your PC" on first run.
  The installer runs only after **More info → Run anyway**, and some antivirus
  products quarantine unsigned installers without asking.
- On Ubuntu, nothing will warn — which is its own risk. `apt` installs a local
  `.deb` without question, so the shop's only protection is where the file came
  from.
- In both cases nothing in the operating system can confirm the file really
  came from us. A package downloaded from anywhere other than the agreed
  channel should not be installed.

Code signing requires a certificate issued to a registered business, and is a
decision about cost, not about engineering.

## What this software does not do

- One computer. Two tills sharing a database over a network are not supported.
- No cloud, no sync, no remote access. Data is on that machine and nowhere else.
- Printing is **not verified on real thermal hardware** yet. Run a test page
  from Settings before relying on silent printing.
- The Windows build has never been produced or installed. Ubuntu is the first
  supported platform.
- Anyone with administrator access to the computer can read the database. The
  file is not encrypted.
