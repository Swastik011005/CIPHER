# Backup materials, offline readiness and recovery

## 1. Offline-readiness checklist (do the night before and again 30 minutes before)
Tick each line; the right-hand column says how to check it.

| # | Item | How to check |
|---|---|---|
| 1 | Presentation laptop charged, charger in the bag | |
| 2 | Repository copy on the laptop is the **v1.0** version, working tree clean | `git status` shows nothing to commit; `git describe --tags` shows `v1.0` |
| 3 | `scripts\setup.cmd` was run on **this** laptop while it had internet (it creates `backend\.venv`, `frontend\node_modules`, `frontend\dist`) | The folders exist |
| 4 | Turn **Wi-Fi off**, then run `scripts\start-demo.cmd` | Browser opens http://127.0.0.1:8000/simulation, top right says **Engine online** |
| 5 | Run S2 Enforce once, then Restart | Counters end at 62 packets, 24 blocked, 4 alerts (see `docs/DEMO_SCRIPT.md`) |
| 6 | `scripts\verify.cmd` prints `ALL CHECKS PASSED` (about 2 minutes; do this earlier in the day, not on stage) | Last line of the output |
| 7 | Browser: full screen (F11), zoom 100%, only one tab, notifications off, window kept in front | |
| 8 | Windows: power mode best performance, plugged in, sleep and screen saver off, display mirroring tested with the projector | |
| 9 | Browser is using the intended GPU (Windows Settings, System, Display, Graphics). On the Intel-only laptop choose **View: Low** | The Quality control shows what you expect |
| 10 | Port 8000 is free (no earlier copy of the app running) | If not, close it, or `set NETSEC_PORT=8010` and open that port |
| 11 | A **USB stick** with a copy of the repository folder **including** `backend\.venv`, `frontend\node_modules` and `frontend\dist` *or* the backup recording (section 3) | Open it on another machine if possible |
| 12 | Printed or second-screen copy of `docs/DEMO_SCRIPT.md` and the slides as PDF | |
| 13 | The backup screenshots (section 2) open in an image viewer on the desktop | |

Note on item 11: a virtual environment copied to another computer may not work (it records absolute paths). The reliable way to
get a second laptop running is `scripts\setup.cmd` with internet access in advance, not copying `.venv`.

## 2. Backup screenshots (real, taken from the running app)
All of these were captured by `scripts/rehearse_demo.mjs`, `scripts/check_offline_recovery.mjs`, `scripts/capture_screens.mjs`
and `scripts/capture_devices.mjs` driving a real Chrome window. None is a mock-up. If the live app fails on the day, show these
in order and tell the audience they are screenshots of the same app.

| Step in the demo | File |
|---|---|
| Overview, three layers | `docs/demo/01-overview.png` |
| S1 normal traffic, packet inspector | `docs/demo/02-s1-packet-inspector.png` |
| S2 port scan, Monitor mode (amber, nothing blocked) | `docs/demo/03-s2-monitor.png` |
| S2 Enforce: PC-2 blocked at IPS-1 | `docs/demo/04-s2-enforce-blocked.png`, `docs/demo/05-s2-packet-dropped.png` |
| S3 TCP reset injected by IPS-1 | `docs/demo/06-s3-reset-inspector.png` |
| S4 rate limit then block | `docs/demo/07-s4-rate-limit.png` |
| Threat Centre, Monitoring | `docs/demo/08-threat-centre.png`, `docs/demo/09-monitoring.png` |
| Custom traffic denied by the ACL | `docs/demo/10-custom-traffic-acl-deny.png` |
| Rules: D1 off, check fails, all checks pass | `docs/demo/11-rules-d1-disabled.png`, `12-rules-s2-check-fails.png`, `13-rules-all-checks-pass.png` |
| Engine offline and recovery | `docs/demo/14-engine-offline.png`, `docs/demo/15-engine-recovered.png` |
| Every page at 1366, 1440 and 1920 wide, every camera preset | `docs/screenshots/` |
| Every device model | `docs/screenshots/devices/` |

## 3. Backup recording: plan (the recording itself is NOT included)
**No video recording exists in this repository.** The assistant that prepared this release could not produce a trustworthy
screen recording of a live demo, and a recording that does not exist must not be claimed. The team should make it:

1. Run the checklist in section 1 with Wi-Fi off. Close notifications.
2. Start a screen recorder (Windows: **Win + Alt + R** with the Xbox Game Bar, or **Win + Shift + S** then the video option of the Snipping Tool; or OBS Studio).
3. Follow `docs/DEMO_SCRIPT.md` section by section at normal pace. Narrate, or add narration later. Target 9 to 10 minutes.
4. Save as `CIPHER-demo-backup.mp4` on the laptop **and** on the USB stick. **Do not commit it to Git** (large file); `docs/` should only reference its name.
5. Play the first 30 seconds to confirm picture and sound before filing it.
6. On the day, if the live app cannot be recovered within two minutes using section 4, say "I will switch to the recording of the same run", and play it.

## 4. Recovery steps on the day
Work down the list; each step is quick. Decide within two minutes whether to continue live or switch to screenshots or the recording.

| Problem | What to do |
|---|---|
| Top right shows **Engine offline** | The backend stopped. In the console window press nothing; start `scripts\start-demo.cmd` again (or rerun `backend\.venv\Scripts\python backend\app.py`). The page reconnects by itself within a few seconds and re-enables Run. A run that is already loaded can still be scrubbed. |
| Console says port 8000 is in use | Close the old window or `taskkill /im python.exe /f` (closes every Python process on the machine), then start again. Or use another port: `set NETSEC_PORT=8010` and open `http://127.0.0.1:8010/simulation`. |
| Page is blank at http://127.0.0.1:8000 | Front end not built: run `scripts\setup.cmd`, or `cd frontend`, `npm run build`. |
| 3D scene is blank or frozen | Bring the browser to the front and move the mouse over the scene (browsers pause drawing for covered or minimised windows). Press a camera button. Try View: Low. Last resort: reload the page (F5); the engine is unaffected. |
| Frame rate is poor | View: Low. Close other applications. Plug in. Set the browser to use the discrete GPU if one exists. Numbers are unaffected. |
| Counters differ from the script | You are on a custom rule set or a run with injected traffic. Rules page: **Reset to shipped**, then **Run** again. Runs are deterministic. |
| A rule edit was refused | The message names the field; use **Reset to shipped**. |
| `setup.cmd` fails during install | Check the internet connection and run it again; it resumes. Only needed on a machine that has never run the app. |
| The laptop will not run it at all | Use the second laptop if it was set up (its install is not tested; see `docs/LIMITATIONS.md`), else the recording, else the screenshots in section 2 with the slides. |
| Browser has no WebGL / hardware acceleration | Chrome Settings, System, "Use graphics acceleration when available" on, restart. Check `chrome://gpu`. |

## 5. After the demo
Close the console window to stop the backend. Nothing is written outside the repository folder; edited rules vanish when the backend stops.
