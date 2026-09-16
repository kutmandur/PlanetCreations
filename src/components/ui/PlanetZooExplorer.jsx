import React, { useEffect, useMemo, useRef, useState, useId } from 'react';
import { TRAITS, MORPHS, BLOCKERS, LOCATIONS, traitGenes, traitGrade, speciesLabel, pairForecast, currentMorph } from '../../utils/planetZooGenetics';
import './PlanetZooExplorer.css';

const percent = (v, digits = 0) => Number.isFinite(v) ? `${(v * 100).toLocaleString('en-GB', { maximumFractionDigits: digits })} %` : 'Unknown';
const probability = (v, digits = 1) => {
    if (!Number.isFinite(v)) return 'Unknown';
    const precision = 10 ** -digits / 100;
    if (v > 0 && v < precision) return `< ${percent(precision, digits)}`;
    if (v < 1 && v > 1 - precision) return `> ${percent(1 - precision, digits)}`;
    return percent(v, digits);
};
const number = (v, digits = 1) => Number.isFinite(v) ? v.toLocaleString('en-GB', { maximumFractionDigits: digits }) : 'Unknown';
const gender = a => a.sex === 1 ? '♀' : a.sex === 0 ? '♂' : '?';
const sexLabel = a => a.sex === 1 ? 'Female' : a.sex === 0 ? 'Male' : 'Unknown sex';
const sexClass = a => a.sex === 1 ? 'female' : a.sex === 0 ? 'male' : 'unknown';
const SexSymbol = ({ animal }) => <span className={`zoo-sex ${sexClass(animal)}`} title={sexLabel(animal)}>{gender(animal)}</span>;
const groupKey = a => a.kind === 'habitat' && a.location !== 0 ? `location:${a.location}` : a.habitats?.[0] || 'unassigned';
const groupOrder = (a, b) => {
    const priority = id => id.startsWith('habitat:') ? 0 : id.startsWith('exhibit:') ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b, undefined, { numeric: true });
};
function Paw({ className = '' }) {
    return <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><ellipse cx="13" cy="26" rx="7" ry="10" transform="rotate(-25 13 26)" /><ellipse cx="27" cy="15" rx="7" ry="10" transform="rotate(-10 27 15)" /><ellipse cx="43" cy="17" rx="7" ry="10" transform="rotate(15 43 17)" /><ellipse cx="54" cy="30" rx="7" ry="10" transform="rotate(30 54 30)" /><path d="M15 47c0-8 9-18 17-18s18 11 18 19c0 14-11 8-18 8S15 61 15 47Z" /></svg>;
}
function Tabs({ value, onChange, items, label }) {
    const id = useId();
    return <div className="zoo-tabs" role="tablist" aria-label={label}>{items.map(([key, text], index) => <button type="button" role="tab" key={key} id={`${id}-${key}`} aria-selected={value === key} tabIndex={value === key ? 0 : -1} className={value === key ? 'is-active' : ''} onClick={() => onChange(key)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        onChange(items[next][0]); event.currentTarget.parentElement.children[next].focus();
    }}>{text}</button>)}</div>;
}
function Stat({ label, children, small }) { return <div className={`zoo-stat ${small ? 'is-small' : ''}`}><span>{label}</span><strong>{children}</strong></div>; }
function Grade({ animal, trait, heading = false }) {
    const raw = traitGrade(animal, trait), ratio = raw === null ? null : raw / trait.max;
    return <div className="zoo-grade"><div>{heading ? <h3>{trait.label}</h3> : <span>{trait.label}</span>}<b>{percent(ratio)}</b></div><div className="zoo-meter"><i style={{ width: `${ratio === null ? 0 : Math.max(0, Math.min(100, ratio * 100))}%` }} /></div></div>;
}
function AnimalCard({ animal, onOpen }) {
    return <button type="button" className="zoo-animal" onClick={() => onOpen(animal.id)} aria-label={`${animal.name}, ${speciesLabel(animal.species)}, Open details`}>
        <div className={`zoo-avatar ${sexClass(animal)}`}><Paw /><span aria-label={sexLabel(animal)}>{gender(animal)}</span></div>
        <div className="zoo-card-heading"><h4>{animal.name}</h4><span>{speciesLabel(animal.species)}</span></div>
        <div className="zoo-card-meta"><span>{number(animal.ageYears)} years</span><span>{animal.kind === 'habitat' ? `Welfare ${percent(animal.welfare)}` : 'Exhibit animal'}</span></div>
        <div className="zoo-card-grades">{TRAITS.filter(t => animal.kind !== 'exhibit' || ['fertility', 'longevity'].includes(t.id)).map(trait => <Grade key={trait.id} animal={animal} trait={trait} />)}</div>
        <div className="zoo-card-footer"><span className={animal.blockers?.length ? 'zoo-status warning' : 'zoo-status'}>{animal.blockers?.length ? BLOCKERS[animal.blockers[0]] : 'View animal details'}</span><span aria-hidden="true">↗</span></div>
    </button>;
}
function PedigreeNode({ id, records, role, onOpen, onNavigate, currentIds, depth = 0, trail = [] }) {
    const a = id && records[id], missing = !a || a.missing, cyclic = id && trail.includes(id);
    return <li><div className={`zoo-tree-node ${missing ? 'is-missing' : ''}`}><small>{role}</small>{id && !missing && !cyclic ? <button type="button" onClick={() => currentIds.has(id) ? onOpen(id) : onNavigate(id)}>{a.name} <SexSymbol animal={a} /></button> : <strong>{cyclic ? 'Cyclic reference' : id ? 'Missing record' : 'Not saved'}</strong>}{id && <span className="zoo-mono">{id}</span>}{a && !a.current && !missing && <span>{a.missingRecord ? 'Parent references from a family copy' : 'Historical record'}</span>}</div>
        {depth < 2 && !cyclic && <ul><PedigreeNode id={a?.mother} records={records} role="Mother" onOpen={onOpen} onNavigate={onNavigate} currentIds={currentIds} depth={depth + 1} trail={[...trail, id]} /><PedigreeNode id={a?.father} records={records} role="Father" onOpen={onOpen} onNavigate={onNavigate} currentIds={currentIds} depth={depth + 1} trail={[...trail, id]} /></ul>}
    </li>;
}
function PedigreeTree({ animal, records, currentIds, onOpen }) {
    const [root, setRoot] = useState(animal.id);
    return <>
        {root !== animal.id && <button type="button" className="zoo-back" onClick={() => setRoot(animal.id)}>← Back to pedigree of {animal.name}</button>}
        <div className="zoo-tree-scroll"><ul className="zoo-tree"><PedigreeNode id={root} records={records} role={root === animal.id ? 'Selected animal' : 'Historical ancestor'} currentIds={currentIds} onOpen={onOpen} onNavigate={setRoot} /></ul></div>
    </>;
}
function GeneGrid({ genes }) {
    const valid = genes?.length === 12 && genes.every(g => Number.isInteger(g) && g >= 0 && g <= 3);
    if (!valid) return <p className="zoo-muted">The genome is incomplete.</p>;
    return <div className="zoo-gene-grid" aria-label="Six gene pairs; rows show the two stored chromosome strands">{[0, 1].map(strand => <div key={strand}><small>Strand {strand + 1}</small>{genes.slice(strand * 6, strand * 6 + 6).map((g, i) => <span key={i} data-allele={g} title={`Locus ${i + 1}, allele ${'ABCD'[g]}`}>{'ABCD'[g]}</span>)}</div>)}</div>;
}
function PartnerList({ animal, data, onPair }) {
    const [result, setResult] = useState(null), [error, setError] = useState('');
    useEffect(() => {
        setResult(null); setError(''); let worker;
        try {
            worker = new Worker(new URL('../../workers/planetZooMatchmaker.worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = event => { if (event.data.error) setError(event.data.error); else setResult(event.data.partners); };
            worker.onerror = () => setError('Partner ranking could not be started. You can still select animals manually in the matchmaker.');
            worker.postMessage({ animal, data });
        } catch { setError('Partner ranking is unavailable in this environment. Select animals manually in the matchmaker.'); }
        return () => worker?.terminate();
    }, [animal, data]);
    const byId = useMemo(() => new Map(data.animals.map(a => [a.id, a])), [data]);
    return <section><div className="zoo-section-title"><div><h3>Compatible partners</h3><p>Same species · opposite sex · animals from this save</p></div></div><p className="zoo-note">Ranked by no known breeding blocks, lower recorded relatedness, more complete ancestry, then higher average genetic score. Available primary traits are weighted equally. Behaviour and future conditions can affect mating.</p>
        {error ? <p role="alert" className="zoo-notice">{error}</p> : !result ? <p role="status" className="zoo-loading">Ranking partners…</p> : !result.length ? <div className="zoo-empty"><Paw /><h3>No partner in this zoo</h3><p>There is no animal of the opposite sex for this species in the current population.</p></div> : <div className="zoo-partners">{result.slice(0, 20).map((p, index) => <button type="button" key={p.id} onClick={() => onPair(animal, byId.get(p.id))}><span className="zoo-rank">{index + 1}</span><div><strong>{byId.get(p.id)?.name} <SexSymbol animal={byId.get(p.id)} /></strong><span>{p.blocked ? 'Breeding block' : p.warningCount ? `${p.warningCount} warnings to review` : 'No known warnings'}{p.missing ? ' · Missing ancestors' : ''}</span></div><div><b>{percent(p.score)}</b><span>Average genetic score</span></div><span aria-hidden="true">→</span></button>)}{result.length > 20 && <p className="zoo-note">Top 20 of {result.length} partners. All animals can be selected in the matchmaker.</p>}</div>}
    </section>;
}
function AnimalDetail({ animal, data, onBack, onOpen, onPair, backLabel = 'Back to animals' }) {
    const [tab, setTab] = useState('overview'), titleRef = useRef(null);
    useEffect(() => { setTab('overview'); titleRef.current?.focus(); }, [animal.id]);
    const morph = currentMorph(animal, data.species[animal.species]);
    const currentIds = useMemo(() => new Set(data.animals.map(a => a.id)), [data]);
    const relatives = data.animals.filter(a => a.mother === animal.id || a.father === animal.id);
    return <div className="zoo-detail" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onBack(); } }}>
        <button type="button" className="zoo-back" onClick={onBack}>← {backLabel}</button>
        <div className="zoo-detail-hero"><div className={`zoo-avatar ${sexClass(animal)}`}><Paw /><span aria-label={sexLabel(animal)}>{gender(animal)}</span></div><div><p className="zoo-eyebrow">{speciesLabel(animal.species)} · <span className={`zoo-sex ${sexClass(animal)}`}>{sexLabel(animal)}</span></p><h2 ref={titleRef} tabIndex={-1}>{animal.name}</h2><p>{number(animal.ageYears)} years · {animal.kind === 'exhibit' ? 'Exhibit' : LOCATIONS[animal.location] || 'Unknown location'}</p></div><span className="zoo-id">{animal.id}</span></div>
        {animal.nameSource === 'fallback' && <p className="zoo-note">No custom name is stored. Showing the species and animal ID.</p>}
        <Tabs value={tab} onChange={setTab} label="Animal details" items={[["overview", 'Condition'], ['pedigree', 'Pedigree'], ['genes', 'Genes'], ['partners', 'Partners']]} />
        <div role="tabpanel" aria-label={{ overview: 'Condition', pedigree: 'Pedigree', genes: 'Genes', partners: 'Partners' }[tab]}>
            {tab === 'overview' && <><div className="zoo-detail-stats"><Stat label="Welfare">{percent(animal.welfare)}</Stat><Stat label="Age">{number(animal.ageYears)} yr</Stat><Stat label="Offspring">{number(animal.offspring, 0)}</Stat><Stat label="Pregnancy">{animal.pregnant == null ? 'Unknown' : animal.pregnant ? 'Yes' : 'No'}</Stat></div><div className="zoo-two-columns"><section className="zoo-surface"><h3>Genetic traits</h3>{TRAITS.filter(t => animal.kind !== 'exhibit' || ['fertility', 'longevity'].includes(t.id)).map(t => <Grade key={t.id} animal={animal} trait={t} />)}<p className="zoo-note">Genetic scores describe inherited traits. Actual body size, age and health are separate state values.</p></section><section className="zoo-surface"><h3>Condition & breeding</h3>{animal.blockers?.length ? <ul className="zoo-warnings">{animal.blockers.map(b => <li key={b}>{BLOCKERS[b]}</li>)}</ul> : <p className="zoo-note">No recorded breeding blocks are active. Full mating eligibility also depends on conditions in the game.</p>}<dl className="zoo-facts"><dt>Contraception</dt><dd>{animal.contraception == null ? 'Unknown' : animal.contraception ? 'Active' : 'Inactive'}</dd><dt>Colour variant</dt><dd>{morph === null ? 'Unknown' : MORPHS[morph] || 'Normal'}</dd><dt>Alpha status</dt><dd>{animal.isAlpha == null ? 'Not determined' : animal.isAlpha ? 'Alpha' : 'Not an alpha'}</dd><dt>Mourning period</dt><dd>{animal.mourningSeconds == null ? 'Unknown' : `${number(animal.mourningSeconds, 0)} s`}</dd>{animal.litterSize != null && <><dt>Saved litter</dt><dd>{animal.litterSize} offspring</dd></>}</dl></section></div></>}
            {tab === 'pedigree' && <><div className="zoo-section-title"><div><h3>Three generations at a glance</h3><p>Animal · parents · grandparents</p></div></div><PedigreeTree animal={animal} records={data.ancestors} currentIds={currentIds} onOpen={onOpen} /><p className="zoo-note">Select a current animal to see its details, or a historical animal to explore earlier generations. Missing parents are marked explicitly. Relatedness calculations include every reachable generation recorded in the save.</p><h3>Offspring in the current population <span className="zoo-count">{relatives.length}</span></h3><div className="zoo-relative-list">{relatives.length ? relatives.map(a => <button key={a.id} type="button" onClick={() => onOpen(a.id)}>{a.name} <SexSymbol animal={a} /> →</button>) : <p className="zoo-muted">No current offspring with a direct parent reference.</p>}</div></>}
            {tab === 'genes' && <><p className="zoo-note">A–D represent the stored alleles 0–3. Each trait uses two strands with six positions. Size and longevity count A/B alleles; fertility and immunity count pairs with different alleles.</p><div className="zoo-two-columns">{TRAITS.filter(t => animal.kind !== 'exhibit' || ['fertility', 'longevity'].includes(t.id)).map(t => <section key={t.id} className="zoo-surface zoo-gene-card"><Grade animal={animal} trait={t} heading /><GeneGrid genes={traitGenes(animal, t)} /></section>)}<section className="zoo-surface zoo-gene-card"><h3>Colour genome</h3><GeneGrid genes={animal.colourGenes} /><p className="zoo-note">Colour variants are identified only when the species rules are known.</p></section>{animal.kind === 'habitat' && <section className="zoo-surface zoo-gene-card"><h3>Resilience</h3><GeneGrid genes={animal.genes?.slice(24, 36)} /><p className="zoo-note">The genetic sequence is readable, but its effect on health is not sufficiently established. It is excluded from partner rankings.</p></section>}</div></>}
            {tab === 'partners' && <PartnerList animal={animal} data={data} onPair={onPair} />}
        </div>
    </div>;
}
function ForecastTrait({ trait, threshold }) {
    const d = trait.distribution, goal = d.probabilities.reduce((sum, p, i) => sum + (i / d.max + 1e-10 >= threshold ? p : 0), 0);
    return <section className="zoo-forecast-trait">
        <div className="zoo-forecast-title"><h4>{trait.label}</h4><b>{percent(d.mean, 1)}<small>Expected value</small></b></div>
        <div className="zoo-histogram" role="img" aria-label={`${trait.label}: Expected value ${percent(d.mean, 1)}, Chance of at least ${percent(threshold)}: ${probability(goal)}`}>
            {d.probabilities.map((p, i) => <div key={i} title={`${percent(i / d.max, 1)} Genetic score: ${probability(p, 2)} Probability`}>
                <i className={i / d.max >= threshold ? 'is-goal' : ''} style={{ height: `${p * 100 / Math.max(...d.probabilities, 0.01)}%` }} />
                <span>{i === 0 || i === d.max || i === Math.floor(d.max / 2) ? `${Math.round(i / d.max * 100)}` : ''}</span>
            </div>)}
        </div>
        <div className="zoo-forecast-meta"><span>10th–90th percentile</span><b>{percent(d.p10)} – {percent(d.p90)}</b></div>
        <div className="zoo-forecast-meta"><span>Chance ≥ {percent(threshold)}</span><b className="zoo-green">{probability(goal)}</b></div>
        <details><summary>Distribution details</summary><table><thead><tr><th>Genetic score</th><th>Probability</th></tr></thead><tbody>{d.probabilities.map((p, i) => <tr key={i}><td>{percent(i / d.max, 1)}</td><td>{probability(p, 3)}</td></tr>)}</tbody></table></details>
    </section>;
}
function Matchmaker({ data, selection, onSelection, onOpen }) {
    const species = useMemo(() => [...new Set(data.animals.map(a => a.species))].sort((a, b) => speciesLabel(a).localeCompare(speciesLabel(b))), [data]);
    const speciesValue = selection.species || species[0] || '';
    const [threshold, setThreshold] = useState(2 / 3);
    const ofSpecies = data.animals.filter(a => a.species === speciesValue), mother = ofSpecies.find(a => a.id === selection.mother && a.sex === 1), father = ofSpecies.find(a => a.id === selection.father && a.sex === 0);
    const forecast = useMemo(() => pairForecast(mother, father, data), [mother, father, data]);
    const picker = (sex, key, label, selected) => <div className={`zoo-picker ${sexClass({ sex })}`}><div className="zoo-picker-title"><span>{sex === 1 ? '♀' : '♂'}</span><label htmlFor={`zoo-${key}`}>{label}</label></div><select id={`zoo-${key}`} value={selected?.id || ''} onChange={e => onSelection({ ...selection, species: speciesValue, [key]: e.target.value })}><option value="">Select a {label.toLowerCase()}…</option>{ofSpecies.filter(a => a.sex === sex).sort((a, b) => a.name.localeCompare(b.name)).map(a => <option value={a.id} key={a.id}>{a.name} · {number(a.ageYears)} yr · {a.id}</option>)}</select>{selected ? <><div className="zoo-picker-info"><span>{number(selected.ageYears)} years</span><span>{selected.kind === 'habitat' ? `Welfare ${percent(selected.welfare)}` : 'Exhibit'}</span></div><div className="zoo-picker-grades">{TRAITS.filter(t => traitGrade(selected, t) !== null).map(t => <span key={t.id}>{t.label}<b>{percent(traitGrade(selected, t) / t.max)}</b></span>)}</div><button className="zoo-text-button" type="button" onClick={() => onOpen(selected.id)}>Open animal details ↗</button></> : <div className="zoo-picker-placeholder"><Paw /><span>{ofSpecies.some(a => a.sex === sex) ? 'Choose an animal to compare' : `No ${label.toLowerCase()} of this species in the current population`}</span></div>}</div>;
    return <div className="zoo-matchmaker"><div className="zoo-section-title"><div><p className="zoo-eyebrow">Breeding planner</p><h2>What could they pass on?</h2><p>Choose two animals of the same species and explore their chances.</p></div></div><label className="zoo-field zoo-species-select">Species<select value={speciesValue} onChange={e => onSelection({ species: e.target.value, mother: '', father: '' })}>{species.map(s => <option key={s} value={s}>{speciesLabel(s)} ({data.animals.filter(a => a.species === s).length})</option>)}</select></label>
        <div className="zoo-pair">{picker(1, 'mother', 'Female', mother)}<div className="zoo-pair-link" aria-hidden="true">♡</div>{picker(0, 'father', 'Male', father)}</div>
        {!forecast ? <div className="zoo-empty zoo-forecast-empty"><span className="zoo-empty-symbol">◇</span><h3>The next generation starts with two animals</h3><p>Select both animals to see genetic distributions, colour variants and mating warnings.</p></div> : <>
            <div className="zoo-prediction-summary"><Stat label="Modelled chance per mating attempt">{percent(forecast.chance, 1)}</Stat><Stat label="Known breeding block">{forecast.blocked ? 'Active' : 'None detected'}</Stat><Stat label="Offspring inbreeding coefficient">{percent(forecast.relation.coefficient, 2)}</Stat></div>
            <p className="zoo-note">The modelled chance applies to an actual mating attempt, using the saved genes and welfare values under the verified species rules. Active blocks prevent regular mating. A birth is not guaranteed.{mother.kind === 'exhibit' ? ' Conception probability for exhibit animals cannot yet be calculated reliably.' : ` Research bonus in the model: ${percent(forecast.researchBonus, 1)}.`}</p>
            {forecast.warnings.length > 0 && <section className="zoo-notice"><h3>Before pairing these animals</h3><ul className="zoo-warnings">{forecast.warnings.map(w => <li key={w.code} className={w.level === 'danger' ? 'is-danger' : ''}>{w.label}</li>)}</ul></section>}
            <div className="zoo-section-title"><div><h3>Potential offspring genetics</h3><p>Probabilities are conditional on offspring being conceived.</p></div><label className="zoo-field">Target score<select value={threshold} onChange={e => setThreshold(Number(e.target.value))}><option value={0.5}>At least 50 %</option><option value={2 / 3}>At least 67 %</option><option value={5 / 6}>At least 83 %</option><option value={1}>100 %</option></select></label></div>
            <div className="zoo-two-columns">{forecast.traits.map(t => <ForecastTrait key={t.id} trait={t} threshold={threshold} />)}</div>{forecast.traits.length === 0 && <p className="zoo-notice">The primary genomes are too incomplete for a prediction.</p>}
            <section className="zoo-surface zoo-colours"><h3>Colour variants</h3>{forecast.colour ? <div>{Object.entries(forecast.colour).sort((a, b) => b[1] - a[1]).map(([index, p]) => <Stat key={index} small label={MORPHS[Number(index)] || 'Normal'}>{p > 0 && p < 0.00001 ? '< 0.001 %' : percent(p, 3)}</Stat>)}</div> : <p className="zoo-muted">Colour genes or verified colour rules for this species are missing.</p>}</section>
            <details className="zoo-model-note"><summary>How this prediction works</summary><p>For habitat animals, the model uses the decoded inheritance rules with 1 % mutation and 1 % strand switching. These are verified defaults; runtime settings cannot be read from every save. Primary genes for exhibit animals use four combinations of complete parental strands. Colour genes also use mutation and strand switching.</p><p>The bars show individual traits. The 10th–90th percentile describes a central range of the distribution, not absolute limits. A high genetic score does not guarantee health or a particular lifespan.</p><p>The inbreeding coefficient is a standard pedigree calculation. Founders are assumed to be unrelated and not inbred; missing ancestors can lead to an underestimate. This is not a decoded in-game penalty. Species and research rules come from the analysed game installation; mods, older versions and runtime changes may differ.</p></details>
        </>}
    </div>;
}
export function PlanetZooExplorerView({ data, onReload }) {
    const [tab, setTab] = useState('animals'), [selectedId, setSelectedId] = useState(null), [search, setSearch] = useState(''), [species, setSpecies] = useState(''), [selection, setSelection] = useState({}), [limit, setLimit] = useState(96);
    const rootRef = useRef(null), opener = useRef(null);
    const selected = data.animals.find(a => a.id === selectedId);
    const open = id => { opener.current = document.activeElement; setSelectedId(id); };
    const back = () => { setSelectedId(null); setTimeout(() => { if (opener.current?.isConnected) opener.current.focus(); else rootRef.current?.focus(); }, 0); };
    const pair = (a, b) => { setSelection({ species: a.species, mother: (a.sex === 1 ? a : b).id, father: (a.sex === 0 ? a : b).id }); setSelectedId(null); setTab('matchmaker'); rootRef.current?.focus(); };
    const filtered = useMemo(() => data.animals.filter(a => (!species || a.species === species) && `${a.name} ${speciesLabel(a.species)} ${a.id}`.toLowerCase().includes(search.toLowerCase().trim())).sort((a, b) => groupOrder(groupKey(a), groupKey(b)) || a.name.localeCompare(b.name, undefined, { numeric: true })), [data, species, search]);
    const groups = useMemo(() => {
        const result = new Map();
        for (const a of filtered.slice(0, limit)) {
            const id = groupKey(a);
            if (!result.has(id)) result.set(id, []); result.get(id).push(a);
        }
        return [...result].sort(([a], [b]) => groupOrder(a, b));
    }, [filtered, limit]);
    const allSpecies = useMemo(() => [...new Set(data.animals.map(a => a.species))].sort(), [data]);
    const groupName = id => id.startsWith('habitat:') ? data.habitats.find(h => h.id === id)?.name || `Habitat ${id.slice(8)}` : id.startsWith('exhibit:') ? `Exhibit ${id.slice(8)}` : id.startsWith('location:') ? LOCATIONS[Number(id.slice(9))] || 'Unknown location' : 'No resolved habitat assignment';
    return <div className="zoo-explorer" ref={rootRef} tabIndex={-1}>
        {selected ? <AnimalDetail key={selected.id} animal={selected} data={data} onBack={back} onOpen={open} onPair={pair} backLabel={tab === 'matchmaker' ? 'Back to matchmaker' : 'Back to animals'} /> : <>
            <div className="zoo-intro"><div><p className="zoo-eyebrow">Planet Zoo · Animal analysis</p><h2>Your zoo. Generation by generation.</h2><p>Get to know your animals, explore their families and plan the next generation.</p></div><div className="zoo-intro-icon"><Paw /></div></div>
            <div className="zoo-summary"><Stat label="Current animals">{number(data.animals.length, 0)}</Stat><Stat label="Species">{allSpecies.length}</Stat><Stat label="Habitats">{data.habitats.length}</Stat><Stat label="Missing ancestors">{data.coverage.missingAncestors}</Stat></div>
            <Tabs value={tab} onChange={setTab} label="Zoo analysis" items={[["animals", 'Animals & habitats'], ['matchmaker', 'Matchmaker']]} />
            {tab === 'animals' ? <div role="tabpanel" aria-label="Animals & habitats"><div className="zoo-toolbar"><label className="zoo-field zoo-search">Search animals<input type="search" placeholder="Name, species or animal ID…" value={search} onChange={e => { setSearch(e.target.value); setLimit(96); }} /></label><label className="zoo-field">Species<select value={species} onChange={e => { setSpecies(e.target.value); setLimit(96); }}><option value="">All species ({allSpecies.length})</option>{allSpecies.map(s => <option key={s} value={s}>{speciesLabel(s)}</option>)}</select></label><span className="zoo-muted">{filtered.length} animals</span></div>
                {!filtered.length && <div className="zoo-empty"><Paw /><h3>{data.animals.length ? 'No matching animals' : 'This zoo has no saved animals yet'}</h3><p>{data.animals.length ? 'Change the search term or species filter.' : 'Animal analysis becomes available once the save contains animals.'}</p></div>}
                {groups.map(([id, animals]) => { const h = data.habitats.find(h => h.id === id); return <section className="zoo-habitat" key={id}><div className="zoo-section-title"><div><p className="zoo-eyebrow">{id.startsWith('exhibit:') ? 'Exhibit' : id.startsWith('habitat:') ? 'Habitat' : 'Location'}</p><h3>{groupName(id)} <span className="zoo-count" title="Animals shown in this group">{animals.length}</span></h3><p>{[...new Set(animals.map(a => speciesLabel(a.species)))].join(' · ')}</p></div>{h && <div className="zoo-habitat-meta"><span>{number(h.landArea, 0)} m² land</span><span>Cleanliness {percent(h.cleanliness)}</span>{h.boundaryComplete === false && <span className="zoo-status warning">Incomplete boundary</span>}</div>}</div><div className="zoo-animal-grid">{animals.map(a => <AnimalCard key={a.id} animal={a} onOpen={open} />)}</div></section>; })}
                {filtered.length > limit && <button type="button" className="zoo-button zoo-load-more" onClick={() => setLimit(n => n + 96)}>Show more animals ({filtered.length - limit})</button>}
                {data.animals.length > 0 && <p className="zoo-note">Habitat and exhibit numbers come from save references. Locations such as quarantine and the trade centre are shown separately. Historical animals appear in the pedigree.</p>}
            </div> : <div role="tabpanel" aria-label="Matchmaker"><Matchmaker data={data} selection={selection} onSelection={setSelection} onOpen={open} /></div>}
        </>}
        {data.warnings.length > 0 && <details className="zoo-notice"><summary>Incomplete analysis · {data.warnings.length} notices</summary><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        <footer className="zoo-footer"><span>Save last modified: {new Date(data.source.modifiedAt).toLocaleString('en-GB')}</span>{onReload && <button type="button" className="zoo-text-button" onClick={onReload}>Reload ↻</button>}<span>Local analysis · {data.source.gameBuild}</span></footer>
    </div>;
}
export default function PlanetZooExplorer({ filePath }) {
    const [state, setState] = useState({ status: 'loading' }), [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false; setState({ status: 'loading' });
        if (!window.electronAPI?.readPlanetZooAnalysis) { setState({ status: 'unsupported' }); return undefined; }
        Promise.resolve().then(() => window.electronAPI.readPlanetZooAnalysis(filePath)).then(data => { if (!data || data.schemaVersion !== 1) throw Error('The animal analysis has an unknown format.'); if (!cancelled) setState({ status: 'ready', data }); }).catch(error => { if (!cancelled) setState({ status: 'error', message: error.message }); });
        return () => { cancelled = true; };
    }, [filePath, attempt]);
    if (state.status === 'ready') return <PlanetZooExplorerView key={`${filePath}:${state.data.source.modifiedAt}`} data={state.data} onReload={() => setAttempt(n => n + 1)} />;
    return <div className="zoo-explorer"><div className="zoo-empty">{state.status === 'loading' ? <><div className="zoo-spinner" /><h3 role="status">Reading animals and pedigrees…</h3><p>Large zoos may take a few seconds.</p></> : state.status === 'unsupported' ? <><Paw /><h3>Animal analysis in the desktop client</h3><p>This client version does not support the new animal analysis yet. Existing zoo statistics are still available.</p></> : <><h3>Animal analysis could not be loaded</h3><p role="alert">{state.message}</p><button type="button" className="zoo-button" onClick={() => setAttempt(n => n + 1)}>Try again</button></>}</div></div>;
}
