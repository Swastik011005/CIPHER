# NetSec 3D: remaining work

Repo `C:\dev\NetSec-3D`, branch `feature/campus-c1-design`. Do not push, merge to main or deploy.

Everything in the master prompt and the later design revisions is done and committed, except these known limitations:
1. High quality on the Intel UHD test GPU: 26.3 fps in the idle overview (target 30); the other High cases are 32 to 33 fps and Low is 60 fps. The cost is post-processing and fill rate (N8AO needs full resolution, see docs/STAGE1_ISSUES.md).
2. The text on the SOC monitoring wall is small at the overview zoom.
3. Building interiors are less dense than the supplied reference image.
4. The device models are procedural and simpler than the reference.

Last verified state: backend 1176, scenario checks 93/93, frontend 350, interaction 70/70, demonstration 35/35, split-check 20/20 and 34/34, offline recovery 8/8.
See `docs/FINAL_EXECUTION_PROGRESS.md` and `docs/NETSEC_3D_FINAL_TECHNICAL_REPORT.md`.
