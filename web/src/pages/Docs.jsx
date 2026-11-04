import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate } from '../lib/router.js';
import { Icon } from '../components/Icons.jsx';
import { Wordmark } from '../components/Shell.jsx';

const Lead = ({ strong, children }) => <p><strong>{strong}</strong> {children}</p>;
const Box = ({ title, children }) => <div className="doc-box"><h4>{title}</h4><p>{children}</p></div>;
const Li = ({ b, children }) => <li><strong>{b}:</strong> {children}</li>;
const Table = ({ head, rows }) => <div className="doc-table"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r[0]}>{r.map((x, i) => <td key={i}>{x}</td>)}</tr>)}</tbody></table></div>;

/** The migration caps, from the live config. */
function Caps({ cfg }) {
  const sizes = (cfg.window?.sizes || []).filter((s) => s.available && s.capSol);
  const usd = (sol) => (cfg.solUsd ? `$${((sol * cfg.solUsd) / 1000).toFixed(1)}K` : `${Math.round(sol)} SOL`);
  return <Table head={['Curve', 'Migrates at about']} rows={sizes.length ? sizes.map((s) => [`${s.sizeSol} SOL`, usd(s.capSol)]) : [['10 SOL', '49.7 SOL market cap'], ['29.7 SOL', '110.7 SOL market cap'], ['42.5 SOL', '163.3 SOL market cap'], ['59.5 SOL', '248.8 SOL market cap']]} />;
}

const PAGES = [
  { group: 'GETTING STARTED', slug: '', title: 'Introduction to IPO', nav: 'Introduction', toc: ['Core Features', 'Core Principles'], body: () => <>
    <Lead strong="IPO stands for Initial Pump Offering.">Every coin starts here with a fair launch on its own curve, then moves to Pumpfun by itself when the curve fills.</Lead>
    <p>The curve has the same shape and the same fees as a Pumpfun coin. What it adds is rules: the token itself checks them on every trade and every send, for as long as the coin is on its curve.</p>
    <Box title="Why IPO?">A launch on Pumpfun is open to snipers and bundles from the first block. IPO puts a tax on the first 3 seconds and a limit on every wallet, then hands your coin to Pumpfun when it has earned it. No extra work for you, nothing to claim for your holders.</Box>
    <h2>Core Features</h2>
    <ul>
      <Li b="Anti-Snipe Tax">About 99% in the first second, gone after three</Li>
      <Li b="3% Max Wallet">No wallet holds more than 3% of the supply on the curve</Li>
      <Li b="3% Trade Guard">One buy or transfer moves at most 3% of the supply</Li>
      <Li b="Automatic Migration">The curve fills, the coin moves to Pumpfun</Li>
      <Li b="Automatic Delivery">Every holder receives the new coin in their wallet</Li>
      <Li b="Custom Pairs">Launch against SOL, USDC or one of Pumpfun's custom pairs</Li>
      <Li b="Creator Rewards">Keep them or give them to your holders, your choice at launch</Li>
    </ul>
    <h2>Core Principles</h2>
    <ul>
      <Li b="Same Fees">1.25% on a SOL pair, the same as Pumpfun</Li>
      <Li b="Enforced on Chain">Rules live in the token, not on this website</Li>
      <Li b="No Exceptions">After the first buy, the creator follows the same limits as everyone</Li>
      <Li b="Nothing Hidden">All choices are fixed at launch and visible on chain</Li>
    </ul>
  </> },
  { group: 'GETTING STARTED', slug: 'quick-start', title: 'Quick Start Guide', nav: 'Quick Start Guide', toc: ['Launch in Five Steps', 'What It Costs'], body: () => <>
    <Lead strong="You can launch a coin in about a minute.">All you need is a Solana wallet with a little SOL.</Lead>
    <h2>Launch in Five Steps</h2>
    <ol>
      <li><strong>Connect your wallet</strong> on the <Link href="/launch">Launch</Link> page.</li>
      <li><strong>Add your coin:</strong> name, ticker, image and links.</li>
      <li><strong>Pick a pair and a migration market cap.</strong> SOL is the default.</li>
      <li><strong>Choose your options:</strong> creator rewards, anti-bundle, trade only, first buy.</li>
      <li><strong>Create the coin</strong> and approve the two wallet prompts: a message, then the transaction.</li>
    </ol>
    <p>Your coin is live the moment the transaction lands. There is nothing else to set up.</p>
    <h2>What It Costs</h2>
    <p>Deploying costs a small amount of SOL, shown on the Launch page before you sign. A first buy is on top of that and is optional. For 24 hours after a ticker launches, using the same ticker again costs 1 SOL.</p>
    <Box title="Good to Know">Coin data is written on chain at launch and cannot be changed afterwards. Check everything before you approve.</Box>
  </> },
  { group: 'GETTING STARTED', slug: 'how-it-works', title: 'How It Works', nav: 'How It Works', toc: ['The Cycle', 'On the Curve', 'After Migration'], body: () => <>
    <Lead strong="A coin on IPO lives in two stages.">First on its own curve with rules, then on Pumpfun as a regular coin.</Lead>
    <h2>The Cycle</h2>
    <ol>
      <li><strong>Launch:</strong> the coin starts on a curve shaped like Pumpfun's. Its address ends in ipo.</li>
      <li><strong>Trade:</strong> the anti-snipe tax runs for 3 seconds, then trading runs on normal fees.</li>
      <li><strong>Fill:</strong> the curve reaches the market cap the creator picked.</li>
      <li><strong>Migrate:</strong> a new Pumpfun coin is created and bought in one transaction.</li>
      <li><strong>Deliver:</strong> every holder receives the new coin automatically.</li>
    </ol>
    <h2>On the Curve</h2>
    <p>Every coin paired with SOL starts from the same point. A coin on a custom pair starts where that pair's curve starts on Pumpfun. Price progression and the amount received are designed to match what you would see on Pumpfun.</p>
    <p>The token enforces its rules through its transfer hook. They apply whether a trade comes through this website, a bot or another application.</p>
    <h2>After Migration</h2>
    <p>The transfer hook is gone and no rules remain. The coin trades on Pumpfun, can graduate on Pumpfun and pays creator rewards according to the choice made at launch.</p>
  </> },
  { group: 'PLATFORM FEATURES', slug: 'explore', title: 'Explore', nav: 'Explore', toc: ['Three Views'], body: () => <>
    <Lead strong="Explore shows every coin launched on IPO.">Search by name, ticker or address.</Lead>
    <h2>Three Views</h2>
    <ul>
      <Li b="Terminal">Three live columns: New Coins, About to Migrate and On Pumpfun</Li>
      <Li b="Cards">The full list as cards, with filters and sorting</Li>
      <Li b="Table">The same list, compact</Li>
    </ul>
    <p>A coin moves to About to Migrate once its curve is 70% full.</p>
  </> },
  { group: 'PLATFORM FEATURES', slug: 'launch-coin', title: 'Launch Coin', nav: 'Launch Coin', toc: ['Your Options'], body: () => <>
    <Lead strong="The Launch page is where every coin starts.">Everything you choose is fixed at launch and visible on chain.</Lead>
    <h2>Your Options</h2>
    <ul>
      <Li b="Pair">SOL, USDC or one of Pumpfun's custom pairs</Li>
      <Li b="Migration Market Cap">When your coin moves to Pumpfun</Li>
      <Li b="Creator Rewards">Creator or holders</Li>
      <Li b="Anti-Bundle">Only one buy can land in each block</Li>
      <Li b="Trade Only">Wallet-to-wallet sends are rejected, the creator's included</Li>
      <Li b="First Buy">Inside the launch transaction, capped at 3% of the supply, skips the tax</Li>
    </ul>
    <p>Ready? <Link href="/launch">Launch your coin</Link>.</p>
  </> },
  { group: 'PLATFORM FEATURES', slug: 'analytics', title: 'Analytics', nav: 'Analytics', toc: ['What You Can See'], body: () => <>
    <Lead strong="Analytics shows what the platform is doing.">Pick 24h, 7d, 30d or all time.</Lead>
    <h2>What You Can See</h2>
    <ul>
      <Li b="Activity">Curve volume, launches, migrations, fees and protocol revenue</Li>
      <Li b="Top Coins">The biggest coins by curve volume</Li>
      <Li b="Where the Fees Went">Creators, holders, protocol and Meteora</Li>
      <Li b="Holders at Migration">Wallets paid and how much they received</Li>
    </ul>
    <p>Dollar figures use today's SOL price. Curve volume comes from each coin's on-chain history once it migrates, and from trades placed on this site while it is on a curve.</p>
  </> },
  { group: 'LAUNCH MECHANICS', slug: 'market-caps', title: 'Migration Market Caps', nav: 'Migration Market Caps', toc: ['The Options'], body: ({ cfg }) => <>
    <Lead strong="The creator picks when the coin migrates.">The coin trades on its curve until that market cap is reached, then migrates by itself. There is no early button.</Lead>
    <h2>The Options</h2>
    <Caps cfg={cfg} />
    <p>Dollar amounts follow the SOL price.</p>
  </> },
  { group: 'LAUNCH MECHANICS', slug: 'anti-snipe', title: 'Anti-Snipe Tax', nav: 'Anti-Snipe Tax', toc: ['The Schedule', 'Where the Tax Goes'], body: () => <>
    <Lead strong="Buying opens the moment a coin launches, with a tax on the first 3 seconds.">A bot buying in those seconds pays for it. A person never has to: this site will not place a buy until the tax has ended.</Lead>
    <h2>The Schedule</h2>
    <Table head={['Second', 'Tax']} rows={[['First', 'About 99%'], ['Second', 'About 23%'], ['Third', 'About 5%'], ['After that', 'The normal fee']]} />
    <p>The creator's optional first buy sits inside the launch transaction and skips the tax.</p>
    <h2>Where the Tax Goes</h2>
    <p>Meteora keeps 20%. The platform's part tops holders up at migration. The rest follows the creator's rewards choice.</p>
  </> },
  { group: 'LAUNCH MECHANICS', slug: 'rules', title: 'Rules on the Curve', nav: 'Rules on the Curve', toc: ['On Every Coin', 'Optional Rules'], body: () => <>
    <Lead strong="The token checks its rules on every trade and every send.">A trade that breaks a rule never lands.</Lead>
    <h2>On Every Coin</h2>
    <ul>
      <Li b="3% Per Wallet">No wallet holds more than 3% of the supply on the curve</Li>
      <Li b="3% Trade Guard">One buy or transfer moves at most 3% of the supply. It does not limit sells</Li>
      <Li b="Creator Included">The only exception is the optional first buy, capped at 3%</Li>
      <Li b="Selling Is Open">Holders can sell at any time</Li>
    </ul>
    <h2>Optional Rules</h2>
    <ul>
      <Li b="Anti-Bundle">Only one buy can land in each block. Some honest buys may need a retry in a busy moment</Li>
      <Li b="Trade Only">The coin only moves in trades with its curve</Li>
    </ul>
    <Box title="Rules End at Migration">When the coin migrates to Pumpfun, the transfer hook is removed. From then on it trades like any other Pumpfun coin.</Box>
  </> },
  { group: 'LAUNCH MECHANICS', slug: 'anti-vamp', title: 'Anti-Vamp', nav: 'Anti-Vamp', toc: [], body: () => <>
    <Lead strong="Copying a new launch costs something.">For 24 hours after a ticker launches, launching another coin with the same ticker costs 1 SOL, for everyone. After that it is free again.</Lead>
    <p>Paid copies do not restart the 24 hours. Every address also ends in ipo, so check the full address before you buy.</p>
  </> },
  { group: 'LAUNCH MECHANICS', slug: 'custom-pairs', title: 'Custom Pairs', nav: 'Custom Pairs', toc: [], body: () => <>
    <Lead strong="Launch against SOL, USDC or one of Pumpfun's custom pairs.">Each pair gets a curve that starts where that pair's curve starts on Pumpfun.</Lead>
    <p>On a non-USDC pair the creator fee can be Pumpfun's default or anything from 0.01% to 3%. The curve charges the same: the creator fee plus 0.95%.</p>
    <p>If a pair can no longer be used at migration, the coin migrates against SOL instead and holders receive more coins, at a lower market cap.</p>
  </> },
  { group: 'MIGRATION', slug: 'migration', title: 'Migration to Pumpfun', nav: 'Migration to Pumpfun', toc: ['Step by Step'], body: () => <>
    <Lead strong="Migration happens by itself when the curve fills.">Nobody has to press anything.</Lead>
    <h2>Step by Step</h2>
    <ol>
      <li><strong>The curve completes</strong> at the selected market cap and the transfer hook is removed.</li>
      <li><strong>The Pumpfun coin is created.</strong> 99% of the SOL in the curve creates and buys it in a single transaction. Same name, ticker and image, about the same market cap.</li>
      <li><strong>Holders receive it.</strong> The coins are sent to every holder based on their balance.</li>
    </ol>
    <Box title="No Sniping the New Coin">The Pumpfun coin's address is not known beforehand, so nobody can buy it before the migration transaction.</Box>
    <p>The new coin has a new address, and it is the real one from here on. The old curve token is finished and only remains as a record of the launch.</p>
  </> },
  { group: 'MIGRATION', slug: 'holders', title: 'What Holders Receive', nav: 'What Holders Receive', toc: ['Where the Difference Goes', 'On a Custom Pair'], body: () => <>
    <Lead strong="Holders usually receive about 97% to 99% of the amount they held.">Less on small curves with many holders. There is nothing to claim and no transaction to sign.</Lead>
    <h2>Where the Difference Goes</h2>
    <ul>
      <li>Meteora keeps 1% of the curve</li>
      <li>Pumpfun charges its fee on the buy</li>
      <li>Sending the coin to each holder costs a little SOL</li>
    </ul>
    <p>The platform's curve fees go toward closing that gap first.</p>
    <p>A very small balance, worth under about 0.005 SOL at migration, is not sent, because sending it would cost more than it is worth.</p>
    <h2>On a Custom Pair</h2>
    <p>The amount also moves with the pair's price against SOL until migration. If the pair rises 10% against SOL, holders receive about 4% to 7% fewer coins. If it falls they receive more. A 3% Pumpfun creator fee lowers the amount by about 1% to 2%.</p>
  </> },
  { group: 'FEES & ECONOMICS', slug: 'fees', title: 'Fee Structure', nav: 'Fee Structure', toc: ['On the Curve', 'On Pumpfun'], body: () => <>
    <Lead strong="Coins here have the same fee options as a Pumpfun coin at launch.">No extra trading fee on top.</Lead>
    <h2>On the Curve</h2>
    <Table head={['Pair', 'Per trade', 'Split']} rows={[['SOL', '1.25%', '0.30% creator, 0.95% protocol'], ['Custom pair', 'Creator fee + 0.95%', 'Creator fee from 0.01% to 3%']]} />
    <h2>On Pumpfun</h2>
    <p>After migration the coin follows Pumpfun's own fee schedule.</p>
  </> },
  { group: 'FEES & ECONOMICS', slug: 'creator-rewards', title: 'Creator Rewards', nav: 'Creator Rewards', toc: ['Set to Creator', 'Set to Holders'], body: () => <>
    <Lead strong="The creator's fee share goes to the creator or to the holders.">Chosen at launch, on the curve and after migration. It cannot be changed.</Lead>
    <h2>Set to Creator</h2>
    <p>Collect your share on the coin page any time while the coin is on the curve. Whatever is left is sent to your wallet at migration. The platform wallet collects these fees on chain and pays them out. An amount under 0.002 SOL is not sent.</p>
    <h2>Set to Holders</h2>
    <p>The creator's share on the curve and what is left of the tax buy holders more coins at migration. On Pumpfun the rewards go to the holders, permanently.</p>
  </> },
];
const GROUPS = [...new Set(PAGES.map((p) => p.group))];
const hrefOf = (p) => (p.slug ? `/docs/${p.slug}` : '/docs');
const idOf = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default function Docs({ path, cfg }) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const article = useRef(null);
  const slug = path.replace(/^\/docs\/?/, '').replace(/\/$/, '');
  const i = PAGES.findIndex((p) => p.slug === slug);
  const page = PAGES[i] ?? PAGES[0];
  const prev = PAGES[i - 1], next = PAGES[i + 1];
  useEffect(() => {
    const el = article.current; if (!el) return; // the headings the side list scrolls to
    el.querySelectorAll('h2').forEach((h) => { h.id = idOf(h.textContent); });
  }, [page]);
  useEffect(() => { document.title = 'Initial Pump Offering'; }, []);
  const Body = useMemo(() => page.body, [page]);
  const copy = () => { navigator.clipboard?.writeText(article.current?.innerText ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  const go = (e, id) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <div className="doc">
      <header className="doc-top">
        <button className="doc-menu" aria-label="Menu" onClick={() => setMenu((m) => !m)}><Icon n="menu" /></button>
        <Link href="/" className="pf-brand"><img src="/icon-48.png" alt="" width="30" height="30" /><Wordmark /><span className="doc-slash">/Docs</span></Link>
        <Link href="/" className="pf-btn quiet small"><Icon n="left" s={15} />Back to App</Link>
      </header>
      <aside className={`doc-side${menu ? ' open' : ''}`}>
        {GROUPS.map((g) => (
          <div key={g} className="doc-group">
            <h4>{g}</h4>
            {PAGES.filter((p) => p.group === g).map((p) => <Link key={p.slug} href={hrefOf(p)} className={p === page ? 'on' : ''} onClick={() => setMenu(false)}>{p.nav}</Link>)}
          </div>
        ))}
      </aside>
      <main className="doc-main">
        <div className="doc-copy"><button className="pf-btn quiet small" onClick={copy}><Icon n="copy" s={15} />{copied ? 'Copied' : 'Copy'}</button></div>
        <article key={page.slug} ref={article} className="doc-body">
          <h1>{page.title}</h1>
          <Body cfg={cfg} />
        </article>
        <nav className="doc-pager">
          {prev ? <button onClick={() => { navigate(hrefOf(prev)); }}><Icon n="chevl" s={16} /><span><small>Previous</small>{prev.nav}</span></button> : <i />}
          {next ? <button className="next" onClick={() => { navigate(hrefOf(next)); }}><span><small>Next</small>{next.nav}</span><Icon n="chevr" s={16} /></button> : <i />}
        </nav>
      </main>
      <aside className="doc-toc">
        {page.toc.map((t) => <a key={t} href={`#${idOf(t)}`} onClick={(e) => go(e, idOf(t))}>{t}</a>)}
      </aside>
    </div>
  );
}
