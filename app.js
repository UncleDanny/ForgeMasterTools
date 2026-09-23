(() => {
    "use strict";

    const FP32 = 2 ** 32;
    const DT_RAW = Math.floor(FP32 / 10);
    const MICRO = 1_000_000;
    const MAX_AS = 480;
    const STEP_AS = 0.001;

    const $ = id => document.getElementById(id);

    let data = null;
    let ageOptions = [];
    let itemOptions = [];

    const CACHE_KEYS = {
        AGE: "attackSpeedCalc_age",
        WEAPON: "attackSpeedCalc_weapon",
        ATTACK_SPEED: "attackSpeedCalc_attackSpeed",
        DOUBLE_CHANCE: "attackSpeedCalc_doubleChance"
    };

    function loadFromCache(key, fallback) {
        const value = localStorage.getItem(key);
        return value ?? fallback;
    }

    function saveToCache(key, value) {
        localStorage.setItem(key, value);
    }

    function ceilDiv(a, b) {
        return Math.floor((a + b - 1) / b);
    }

    function getIncrement(asBonus) {
        const speedMicro = Math.floor((1 + asBonus / 100) * MICRO);
        return Math.floor((DT_RAW * speedMicro) / FP32);
    }

    function calculate(asBonus, windup, attackDuration) {
        const inc = getIncrement(asBonus);
        const durationUs = Math.floor(attackDuration * MICRO);
        const windupUs = Math.floor(windup * MICRO);

        const normalTicks = ceilDiv(durationUs, inc) + 1;
        const firstTicks = ceilDiv(windupUs, inc);
        const resetUs = Math.floor(750_000 * windup);
        const recoveryTicks = ceilDiv(durationUs - resetUs, inc);
        const doubleTicks = firstTicks + recoveryTicks + 1;
        const gapTicks = Math.max(1, ceilDiv(Math.floor(250_000 * windup), inc));

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
        return (
            t.normalCycle * (1 - dc) +
            t.doubleCycle * dc
        ) / (1 + dc);
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

    function ageLabel(age) {
        return data?.ages?.[String(age)] ?? `Age ${age}`;
    }

    function rebuildItemOptions() {
        const age = $("age").value;
        itemOptions = age === "skins"
            ? data.items.filter(item => item.kind === "skin")
            : data.items.filter(item =>
                item.kind === "weapon" && String(item.age) === String(age)
            );

        const groups = { melee: [], ranged: [] };

        for (const item of itemOptions) {
            groups[item.category]?.push(item);
        }

        for (const group of Object.values(groups)) {
            group.sort((a, b) =>
                String(a.displayName ?? "").localeCompare(String(b.displayName ?? "")) ||
                a.index - b.index
            );
        }

        $("weapon").innerHTML = ["melee", "ranged"].map(category => {
            const items = groups[category];
            if (!items.length) return "";
            return `<optgroup label="${category === "melee" ? "Melee" : "Ranged"}">` +
                items.map((item, i) =>
                    `<option value="${escapeHtml(itemKey(item))}">${escapeHtml(item.displayName ?? (item.kind === "skin" ? "Unnamed skin" : "Unnamed weapon"))}</option>`
                ).join("") +
                "</optgroup>";
        }).join("");

        const cached = loadFromCache(CACHE_KEYS.WEAPON, "");
        if ([...$("weapon").options].some(o => o.value === cached)) {
            $("weapon").value = cached;
        }
    }

    function itemKey(item) {
        return `${item.kind}:${item.age ?? "skin"}:${item.category}:${item.index}:${item.baseSetId ?? ""}`;
    }

    function getSelectedItem() {
        const key = $("weapon").value;
        return itemOptions.find(item => itemKey(item) === key) ?? itemOptions[0] ?? null;
    }

    function renderAgeOptions() {
        const ages = [...new Set(data.items
            .filter(item => item.kind === "weapon" && item.age !== null && item.age !== 10000)
            .map(item => item.age))]
            .sort((a, b) => a - b);

        ageOptions = ages.map(String);
        $("age").innerHTML = ages.map(age =>
            `<option value="${age}">${escapeHtml(ageLabel(age))}</option>`
        ).join("") + `<option value="skins">Weapon Skins</option>`;
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

        $("targets").innerHTML = upcoming.length
            ? upcoming.map(r => {
                const t = calculate(r.as, windup, attackDuration);
                const effective = effectiveTime(t, dc);
                const gain = nowEffective > 0 ? (1 - effective / nowEffective) * 100 : 0;
                return `<div class="target">
                    <strong>${formatAs(r.as)}</strong>
                    <span>${formatSec(t.doubleCycle)} double cycle · ${formatSec(effective, 3)}/hit · ${gain.toFixed(1)}% faster effective timing</span>
                </div>`;
            }).join("")
            : '<div class="target"><strong>+480.0%</strong><span>No further Double Attack breakpoint within the configured gear cap.</span></div>';
    }

    function renderEmptyState(message) {
        document.body.innerHTML = `
            <main class="page">
                <section class="panel empty-state">
                    <h1>No weapon timing data</h1>
                    <p>${escapeHtml(message)}</p>
                </section>
            </main>`;
    }

    function render() {
        const item = getSelectedItem();

        if (!item || !Number.isFinite(item.windup) || !Number.isFinite(item.attackDuration)) {
            renderEmptyState("The selected item has no WindupTime or AttackDuration.");
            return;
        }

        const as = Math.max(0, Math.min(MAX_AS, Number($("attackSpeed").value) || 0));
        const dc = Math.max(0, Math.min(100, Number($("doubleChance").value) || 0)) / 100;
        const t = calculate(as, item.windup, item.attackDuration);
        const name = item.displayName ?? (item.kind === "skin" ? "Unnamed skin" : "Unnamed weapon");

        $("windup").textContent = `${item.windup.toFixed(3)}s`;
        $("skinWeapon").textContent = `${name} · ${item.category} · ${item.attackDuration.toFixed(3)}s duration`;
        $("normalCycle").textContent = formatSec(t.normalCycle);
        $("hitGap").textContent = formatSec(t.gap);
        $("doubleCycle").textContent = formatSec(t.doubleCycle);

        $("speedMultiplier").textContent = `${t.speedMultiplier.toFixed(6)}×`;
        $("increment").textContent = `${(t.inc / MICRO).toFixed(6)}s/tick`;
        $("firstTicks").textContent = t.firstTicks;
        $("recoveryTicks").textContent = t.recoveryTicks;
        $("idleTicks").textContent = t.idleTicks;
        $("effectiveTime").textContent = `${effectiveTime(t, dc).toFixed(3)}s`;

        $("doubleHeading").textContent = `${name} · ${item.category} Double Attack`;
        $("windupTag").textContent = `${item.windup.toFixed(3)}s windup · ${item.attackDuration.toFixed(3)}s duration`;

        renderNormalTable(as, item.attackDuration);
        const rows = renderDoubleTable(as, item.windup, item.attackDuration);
        renderTargets(rows, as, item.windup, item.attackDuration, dc);
    }

    async function init() {
        try {
            const response = await fetch("WeaponData.json");
            if (!response.ok) throw new Error(`WeaponData.json returned ${response.status}.`);

            data = await response.json();
            if (!Array.isArray(data.items) || !data.items.length) {
                throw new Error("WeaponData.json contains no items.");
            }

            renderAgeOptions();

            const cachedAge = loadFromCache(CACHE_KEYS.AGE, String(ageOptions[0]));
            $("age").value = ["skins", ...ageOptions].includes(cachedAge)
                ? cachedAge
                : String(ageOptions[0]);

            rebuildItemOptions();

            $("attackSpeed").value = loadFromCache(CACHE_KEYS.ATTACK_SPEED, "0.0");
            $("doubleChance").value = loadFromCache(CACHE_KEYS.DOUBLE_CHANCE, "0.0");

            $("age").addEventListener("change", () => {
                saveToCache(CACHE_KEYS.AGE, $("age").value);
                rebuildItemOptions();
                render();
            });

            $("weapon").addEventListener("change", () => {
                saveToCache(CACHE_KEYS.WEAPON, $("weapon").value);
                render();
            });

            ["attackSpeed", "doubleChance"].forEach(id => {
                $(id).addEventListener("input", () => {
                    saveToCache(CACHE_KEYS[id.toUpperCase()], $(id).value);
                    render();
                });
            });

            render();
        } catch (error) {
            console.error(error);
            renderEmptyState(`Could not load WeaponData.json: ${error.message}`);
        }
    }

    init();
})();
