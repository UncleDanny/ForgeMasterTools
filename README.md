# Attack Speed Breakpoints

Calculator for the game's 10-tick combat timing model.

## Data source

The calculator loads weapon and skin timing data from:

```text
WeaponData.json
```

The file provides the item name, type/category, windup time, attack duration, and related identifiers used by the calculator.

`app.js` is the runtime implementation and `index.html` contains the authoritative user-facing explanation of the timing model.

## Timing model

Combat runs at **10 simulation ticks per second** (0.1s per tick).

Attack Speed is converted to the game's fixed-point speed multiplier:

```text
speed = 1 + attackSpeedBonus / 100
```

The calculator reproduces the game's F64/FD6 fixed-point timer arithmetic using integer calculations rather than a simplified floating-point timer.

### Normal attacks

A normal attack follows:

```text
Idle -> WindingUp -> OnCooldown -> Idle
```

The hit occurs when the attack timer reaches the weapon/skin's windup duration. The timer then continues through the attack duration. A one-tick `Idle -> WindingUp` transition is included in the normal cycle.

### Double Attack

On a Double Attack proc, the first hit has already occurred. The timer is reset to **75% of the windup duration** (`DoubleAttackSpeedUp = 4`) and the second hit begins without an intervening Idle tick.

The Double Attack cycle is measured as:

```text
first hit -> second hit -> next normal hit
```

This makes Double Attack timing dependent on the selected weapon/skin's windup.

## Effective time per hit

Double Chance produces two hits when it procs. The calculator uses:

```text
((1 - p) × normal + p × double) / (1 + p)
```

to calculate expected time per hit, where `p` is Double Chance as a fraction from 0 to 1.

## Breakpoints

Attack Speed breakpoints are scanned from:

```text
0% to +480%
```

at `0.001%` resolution.

A breakpoint is recorded whenever the calculated number of simulation ticks changes.

The UI shows separate breakpoint tables for:

- Normal attacks
- Double Attacks
- Upcoming Double Attack improvements

Breakpoint Attack Speed values can be displayed with three decimals for the accurate thresholds or one decimal to match the in-game visual rounding.

## Inputs

**Attack Speed**

- 0%–480%
- 0.1% UI step

**Double Chance**

- 0%–100%
- 0.1% UI step
- Used for effective time / hit and upcoming-target calculations

The selected age, weapon, Attack Speed, Double Chance, and breakpoint display precision are stored in `localStorage`.

## Implementation notes

Normal attack timing normally simplifies to being independent of windup, while Double Attack timing does not.

At sufficiently high Attack Speed, the normal cooldown can hit the game's one-tick minimum, so the calculator retains the full fixed-point calculation rather than relying only on the simplified formula.
