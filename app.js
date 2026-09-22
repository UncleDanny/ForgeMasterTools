(() => {
    "use strict";

    const FP32 = 2 ** 32;
    const DT_RAW = Math.floor(FP32 / 10);
    const MICRO = 1_000_000;
    const MAX_AS = 480;
    const STEP_AS = 0.1;
    const DEFAULT_ATTACK_SPEED = 0;
    const DEFAULT_DOUBLE_CHANCE = 0;

    const $ = id => document.getElementById(id);

    let skinsData = null;
    let weaponData = null;
    let skinOptions = [];

    function ceilDiv(a, b) {
        return Math.floor((a + b - 1) / b);
    }

    // Exact supplied FD6 model. AS bonus +151% => speed multiplier 2.51.
    function getIncrement(asBonus) {
        const speedMicro = Math.round((1 + asBonus / 100) * MICRO);
        return Math.floor((DT_RAW * speedMicro) / FP32);
    }

    function calculate(asBonus, windup, attackDuration) {
        const inc = getIncrement(asBonus);
        const durationUs = Math.round(attackDuration * MICRO);
        const windupUs = Math.round(windup * MICRO);

        // Normal attack: timer reaches AttackDuration, then one idle tick.
        const normalTicks = ceilDiv(durationUs, inc) + 1;

        // Double sequence: first hit at the skin's configured windup.
        const firstTicks = ceilDiv(windupUs, inc);

        // Double proc resets the attack timer to 75% of windup.
        const resetUs = Math.round(750_000 * windup);
        const recoveryUs = durationUs - resetUs;
        const recoveryTicks = ceilDiv(recoveryUs, inc);

        // One idle tick occurs after the timer completes.
        const doubleTicks = firstTicks + recoveryTicks + 1;

        // Time from first hit to second hit.
        const gapTicks = Math.max(1, ceilDiv(Math.round(250_000 * windup), inc));

        return {
            inc,
            speedMultiplier: 1 + asBonus / 100,
            normalTicks,
            normalCycle: normalTicks / 10,
            firstTicks,
            recoveryTicks,
            idleTicks: 1,
            doubleTicks,
            doubleCycle: doubleTicks / 10,
            gapTicks,
            gap: gapTicks / 10,
            afterSecondTicks: doubleTicks - gapTicks,
            afterSecond: (doubleTicks - gapTicks) / 10
        };
    }

    function buildBreakpoints(windup, attackDuration, mode) {
        const rows = [];
        let previous = null;
        const maxIndex = Math.round(MAX_AS / STEP_AS);

        // Integer indices avoid accumulating floating-point error.
        for (let i = 0; i <= maxIndex; i++) {
            const as = i * STEP_AS;
            const t = calculate(as, windup, attackDuration);
            const value = mode === "normal" ? t.normalTicks : t.doubleTicks;

            if (previous === null || value !== previous) {
                rows.push({ as, ...t });
                previous = value;
            }
        }

        return rows;
    }

    function effectiveTime(t, dc) {
        return (t.normalCycle + dc * t.gap) / (1 + dc);
    }

    function formatAs(x) {
        return `${x.toFixed(1)}%`;
    }

    function formatSec(x, digits = 2) {
        return `${x.toFixed(digits)}s`;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function friendlySetName(baseSetId) {
        return String(baseSetId || "Unknown Set")
            .replace(/Set$/, "")
            .replace(/([A-Z])/g, " $1")
            .trim();
    }

    function parseItemKey(key) {
        // WeaponLibrary keys are serialized Unity dictionaries such as:
        // "{'Age': -1000, 'Type': 'Weapon', 'Idx': 12}"
        const age = Number(key.match(/'Age':\s*(-?\d+)/)?.[1]);
        const type = key.match(/'Type':\s*'([^']+)'/)?.[1];
        const idx = Number(key.match(/'Idx':\s*(-?\d+)/)?.[1]);
        return { age, type, idx };
    }

    function buildWeaponTimingLookup(data) {
        const lookup = new Map();

        for (const [key, value] of Object.entries(data || {})) {
            const itemId = value.ItemId || parseItemKey(key);
            if (itemId.Type !== "Weapon" || !Number.isInteger(itemId.Idx)) continue;

            let kind = null;
            if (itemId.Age === -1000) kind = "melee";
            if (itemId.Age === -1001) kind = "ranged";
            if (!kind) continue;

            if (!lookup.has(itemId.Idx)) lookup.set(itemId.Idx, {});
            lookup.get(itemId.Idx)[kind] = {
                windup: Number(value.WindupTime),
                duration: Number(value.AttackDuration)
            };
        }

        return lookup;
    }

    function buildSkinOptions(skins, timingLookup) {
        return Object.values(skins || {})
            .filter(skin => skin?.SkinId?.Type === "Weapon")
            .map(skin => {
                const idx = skin.SkinId.Idx;
                const timing = timingLookup.get(idx);
                return {
                    idx,
                    name: friendlySetName(skin.BaseSetId),
                    baseSetId: skin.BaseSetId || "",
                    melee: timing?.melee || null,
                    ranged: timing?.ranged || null
                };
            })
            .filter(skin => skin.melee || skin.ranged)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    function renderSkinOptions() {
        $("skin").innerHTML = skinOptions.map((skin, i) =>
            `<option value="${i}">${escapeHtml(skin.name)}</option>`
        ).join("");
    }

    function getSelectedSkin() {
        const index = Number.parseInt($("skin").value, 10);
        return Number.isInteger(index) && skinOptions[index] ? skinOptions[index] : skinOptions[0] || null;
    }

    function getSelectedTiming() {
        const skin = getSelectedSkin();
        if (!skin) return null;
        return $("weapon").value === "melee" ? skin.melee : skin.ranged;
    }

    function statusForBreakpoint(rows, index, currentAs) {
        const row = rows[index];
        const next = rows[index + 1];

        if (currentAs >= row.as && (!next || currentAs < next.as)) {
            return { className: "current", html: '<span class="status reached">CURRENT</span>' };
        }

        if (row.as > currentAs && (!index || rows[index - 1].as <= currentAs)) {
            return { className: "next", html: '<span class="status next-status">NEXT</span>' };
        }

        return { className: "", html: "" };
    }

    function renderNormalTable(currentAs, attackDuration) {
        const rows = buildBreakpoints(0, attackDuration, "normal");
        $("normalRows").innerHTML = rows.map((r, i) => {
            const status = statusForBreakpoint(rows, i, currentAs);
            return `<tr class="${status.className}">
        <td>${formatAs(r.as)}</td>
        <td>${formatSec(r.normalCycle)}</td>
        <td>${r.normalTicks}</td>
        <td>${status.html}</td>
      </tr>`;
        }).join("");
    }

    function renderDoubleTable(currentAs, windup, attackDuration) {
        const rows = buildBreakpoints(windup, attackDuration, "double");
        $("doubleRows").innerHTML = rows.map((r, i) => {
            const status = statusForBreakpoint(rows, i, currentAs);
            return `<tr class="${status.className}">
        <td>${formatAs(r.as)}</td>
        <td>${formatSec(r.doubleCycle)}</td>
        <td>${formatSec(r.gap)}</td>
        <td>${formatSec(r.afterSecond)}</td>
        <td>${status.html}</td>
      </tr>`;
        }).join("");
        return rows;
    }

    function renderTargets(rows, currentAs, windup, attackDuration, dc) {
        const now = calculate(currentAs, windup, attackDuration);
        const nowEffective = effectiveTime(now, dc);
        const upcoming = rows.filter(r => r.as > currentAs).slice(0, 3);

        if (!upcoming.length) {
            $("targets").innerHTML = '<div class="target"><strong>+480.000%</strong><span>No further Double Attack breakpoint within the configured gear cap.</span></div>';
            return;
        }

        $("targets").innerHTML = upcoming.map(r => {
            const t = calculate(r.as, windup, attackDuration);
            const effective = effectiveTime(t, dc);
            const gain = nowEffective > 0 ? (1 - effective / nowEffective) * 100 : 0;

            return `<div class="target">
        <strong>${formatAs(r.as)}</strong>
        <span>${formatSec(t.doubleCycle)} double cycle · ${formatSec(effective, 3)}/hit · ${gain.toFixed(1)}% faster effective timing</span>
      </div>`;
        }).join("");
    }

    function renderEmptyState(message = "No weapon skins with timing data were found.") {
        document.body.innerHTML = `
      <main class="page">
        <section class="panel empty-state">
          <h1>No skin timing data</h1>
          <p>${escapeHtml(message)}</p>
        </section>
      </main>`;
    }

    function render() {
        const skin = getSelectedSkin();
        const timing = getSelectedTiming();

        if (!skin || !timing || !Number.isFinite(timing.windup) || !Number.isFinite(timing.duration)) {
            renderEmptyState("The selected skin/weapon has no WindupTime or AttackDuration in WeaponLibrary.json.");
            return;
        }

        const as = Math.max(0, Math.min(MAX_AS, Number($("attackSpeed").value) || 0));
        const dc = Math.max(0, Math.min(100, Number($("doubleChance").value) || 0)) / 100;
        const t = calculate(as, timing.windup, timing.duration);
        const weaponName = $("weapon").value === "melee" ? "Melee" : "Ranged";

        $("windup").textContent = `${timing.windup.toFixed(3)}s`;
        $("skinWeapon").textContent = `${skin.name} · ${weaponName} · ${timing.duration.toFixed(3)}s duration`;

        $("normalCycle").textContent = formatSec(t.normalCycle);
        $("hitGap").textContent = formatSec(t.gap);
        $("doubleCycle").textContent = formatSec(t.doubleCycle);

        $("speedMultiplier").textContent = `${t.speedMultiplier.toFixed(6)}×`;
        $("increment").textContent = `${(t.inc / MICRO).toFixed(6)}s/tick`;
        $("firstTicks").textContent = t.firstTicks;
        $("recoveryTicks").textContent = t.recoveryTicks;
        $("idleTicks").textContent = t.idleTicks;
        $("effectiveTime").textContent = `${effectiveTime(t, dc).toFixed(3)}s`;

        $("doubleHeading").textContent = `${skin.name} · ${weaponName} Double Attack`;
        $("windupTag").textContent = `${timing.windup.toFixed(3)}s windup · ${timing.duration.toFixed(3)}s duration`;

        renderNormalTable(as, timing.duration);
        const rows = renderDoubleTable(as, timing.windup, timing.duration);
        renderTargets(rows, as, timing.windup, timing.duration, dc);
    }

    async function init() {
        try {
            const [skinsResponse, weaponResponse] = await Promise.all([
                fetch("SkinsLibrary.json"),
                fetch("WeaponLibrary.json")
            ]);

            if (!skinsResponse.ok || !weaponResponse.ok) {
                throw new Error(`Data load failed (${skinsResponse.status}/${weaponResponse.status}).`);
            }

            skinsData = await skinsResponse.json();
            weaponData = await weaponResponse.json();

            const timingLookup = buildWeaponTimingLookup(weaponData);
            skinOptions = buildSkinOptions(skinsData, timingLookup);

            if (!skinOptions.length) {
                renderEmptyState();
                return;
            }

            renderSkinOptions();
            $("skin").value = "0";
            $("attackSpeed").value = DEFAULT_ATTACK_SPEED.toFixed(1);
            $("doubleChance").value = DEFAULT_DOUBLE_CHANCE.toFixed(1);

            ["skin", "weapon", "attackSpeed", "doubleChance"].forEach(id => {
                $(id).addEventListener("input", render);
                $(id).addEventListener("change", render);
            });

            render();
        } catch (error) {
            console.error(error);
            renderEmptyState("Could not load SkinsLibrary.json and WeaponLibrary.json. Make sure both files are published beside index.html.");
        }
    }

    init();
})();
