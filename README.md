# Attack Speed Breakpoints

Calculator for the game's 10-tick combat timing model.

## Timing model

The calculator uses the supplied FD6 model:

```text
speed = 1 + attackSpeedBonus / 100
inc = floor(dt_raw × round(speed × 1e6) / 2^32)
```

where combat runs at 10 simulation ticks per second.

Normal attack cycle:

```text
ceil(AttackDuration / inc) + 1 idle tick
```

Double Attack:

```text
first hit = ceil(WindupTime / inc)
reset = 0.75 × WindupTime
recovery = ceil((AttackDuration - reset) / inc)
double cycle = first hit + recovery + 1 idle tick
```

First-to-second-hit delay:

```text
max(1, ceil(0.25 × WindupTime / inc))
```

The breakpoint scan runs from 0% through +480% Attack Speed at 0.001% resolution.
