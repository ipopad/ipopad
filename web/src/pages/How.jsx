import { Link } from '../lib/router.js';

const Step = ({ n, title, children }) => (
  <div className="how-step">
    <div className="how-n">{n}</div>
    <div style={{ display: 'grid', gap: 6 }}><div className="b" style={{ color: '#fff' }}>{title}</div>{children}</div>
  </div>
);
const Rule = ({ title, children }) => (
  <div className="how-rule"><div className="b" style={{ color: '#fff' }}>{title}</div><p>{children}</p></div>
);

/** How it works (operator's copy, 25 Oct 2026). Market caps come from the live config. */
export default function How({ cfg }) {
  const sizes = (cfg.window?.sizes || []).filter((s) => s.available && s.capSol);
  const usd = (sol) => (cfg.solUsd ? `$${((sol * cfg.solUsd) / 1000).toFixed(1)}k` : `${Math.round(sol)} SOL`);
  return (
    <main className="wrap">
      <div className="how">
        <Link href="/" className="bracket back">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">IPO stands for Initial Pump Offering. Every coin starts here with a fair launch.</p>
        <p>Every coin paired with SOL starts from the same point, a coin on a custom pair starts where that pair's curve starts on Pumpfun. Each trades on its own curve and follows the rules chosen by its creator.</p>
        <p>Once the curve reaches its selected market cap, the coin automatically migrates to Pumpfun and becomes a regular Pumpfun coin. Every holder receives the migrated coin automatically.</p>

        <h2>Launching a Coin</h2>
        <Step n="1" title="Create the Coin">
          <p>Choose the name, ticker, image and links for your coin.</p>
          <p>Every token address ends in <span className="green">ipo</span>, on the curve and on Pumpfun. The coin's core data is written on chain at launch and cannot be changed afterwards.</p>
          <p>For 24 hours after a ticker launches, launching another coin with the same ticker costs 1 SOL, for everyone. After that it is free again. This makes copying a new launch cost something.</p>
        </Step>
        <Step n="2" title="The Anti-Snipe Tax">
          <p>Buying opens the moment a coin launches, with a tax on the first 3 seconds: about 99% in the first second, 23% in the next, then 5%, then the normal fee.</p>
          <p>A bot buying in those seconds pays for it. A person never has to, and this site will not place a buy until the tax has ended.</p>
          <p>The creator can make a first buy inside the launch transaction, capped at 3% of the supply. That buy skips the tax.</p>
        </Step>
        <Step n="3" title="Choose the Migration Market Cap">
          <p>Choose when your coin should migrate:</p>
          <ul>{sizes.map((s) => <li key={s.sizeSol}>{usd(s.capSol)} market cap</li>)}</ul>
          <p>Your coin continues trading on the curve until the selected market cap is reached. Once it is reached, the coin automatically migrates to Pumpfun.</p>
        </Step>
        <Step n="4" title="Add Optional Rules">
          <p>Creators can add additional rules to their launch. Every rule is written into the token at launch and enforced on chain until the coin migrates.</p>
          <div className="how-rule"><div className="b" style={{ color: '#fff' }}>Creator rewards</div><p>Choose where Pumpfun creator rewards go after migration:</p>
            <ul><li>The creator, following Pumpfun's reward schedule</li><li>The holders, permanently</li></ul></div>
          <Rule title="Anti-bundle">Only one buy can land in each block for the whole time on the curve. Some honest buys may need a retry in a busy moment.</Rule>
          <Rule title="Trade only">The coin only moves in trades with its curve. Wallet-to-wallet sends are rejected, the creator's included.</Rule>
          <p>All choices are fixed at launch and visible on chain. The rules a coin carries are listed on its page.</p>
        </Step>

        <h2>Trading on the Curve</h2>
        <p>The launch curve follows the same shape and starting market cap as a Pumpfun coin.</p>
        <p>That means the price progression and amount received at each point on the curve are designed to match what you would see on Pumpfun.</p>
        <p>The token itself enforces the launch rules through its transfer hook. The rules apply regardless of whether a trade comes through this website, a bot or another application.</p>
        <h3>The rules</h3>
        <Rule title="3% per wallet">No wallet can hold more than 3% of the supply while the coin is on its curve. This applies to every coin.</Rule>
        <Rule title="No huge single buys">Every coin has a 3% trade guard: one buy or transfer can move at most 3% of the supply. Bigger buyers have to split up. It does not limit sells.</Rule>
        <Rule title="The creator's rules are enforced">Every optional rule the creator added is checked by the token on every trade and every send. A trade that breaks a rule never lands.</Rule>
        <Rule title="The creator's wallet is not above the rules">The creator's only exception is the optional first buy inside the launch transaction, capped at 3% of the supply. After that the creator follows the same limits as everyone.</Rule>
        <Rule title="Selling is available">Holders can sell at any time.</Rule>
        <Rule title="Rules end at migration">When the coin migrates to Pumpfun, the transfer hook is removed. From then on it trades like any other Pumpfun coin, with no rules attached.</Rule>

        <h2>Fees</h2>
        <p>Coins here have the same fee options as a Pumpfun coin at launch.</p>
        <Rule title="Paired with SOL">Every trade on the curve pays 1.25%: 0.30% to the creator and 0.95% to the protocol. On Pumpfun the coin follows Pumpfun's own fee schedule.</Rule>
        <Rule title="Custom pair">Pick one of Pumpfun's custom pairs and the creator fee can be Pumpfun's default or anything from 0.01% to 3%. The curve charges the same: the creator fee plus 0.95%.</Rule>
        <Rule title="The anti-snipe tax">Meteora keeps 20% of it. The platform's part tops holders up at migration. The rest follows the creator's rewards choice below.</Rule>
        <Rule title="Creator rewards">The creator's fee share goes to the creator or to the holders, chosen at launch, on the curve and after migration. Set to holders, the creator's share on the curve and what is left of the tax buy holders more coins at migration. Set to creator, they go to the creator: collect your share on the coin page any time while the coin is on the curve, and whatever is left is sent to your wallet at migration. The platform wallet collects these fees on chain and pays them out. An amount under 0.002 SOL is not sent.</Rule>

        <h2>Migrating to Pumpfun</h2>
        <Step n="1" title="The Curve Reaches Its Target">
          <p>When the selected market cap is reached, the curve completes.</p>
          <p>The transfer hook is then removed and the token is ready to migrate.</p>
        </Step>
        <Step n="2" title="The Curve Creates the Pumpfun Coin">
          <p>99% of the SOL in the curve is used to create and buy the Pumpfun coin in a single transaction. On a custom pair the SOL is swapped into the pair just before that. If the pair can no longer be used, the coin migrates against SOL instead and holders receive more coins, at a lower market cap.</p>
          <p>The new coin uses the same name, ticker and image and opens at about the same market cap.</p>
          <p>The Pumpfun coin address is not known beforehand, so nobody can buy it before the migration transaction.</p>
        </Step>
        <Step n="3" title="Every Holder Receives the New Coin">
          <p>The Pumpfun coins are distributed automatically to every holder based on their balance.</p>
          <p>Holders usually receive about 97% to 99% of the amount they held, less on small curves with many holders. On a custom pair the curve starts where that pair's curve starts on Pumpfun, so the amount is similar, but it also moves with the pair's price against SOL until migration: if the pair rises 10% against SOL holders receive about 4% to 7% fewer coins, if it falls they receive more. A higher Pumpfun creator fee lowers the amount too, by about 1% to 2% at 3%. Meteora keeps 1% of the curve, Pumpfun charges its fee on the buy, and sending the coin to each holder costs a little SOL. The platform's curve fees go toward closing that gap first.</p>
          <p>There is nothing to claim and no transaction to sign.</p>
          <p>The new coin has a new address. The Pumpfun coin is the real one from here on. The old curve token is finished and only remains as a record of the launch.</p>
        </Step>
        <Step n="4" title="It's Now a Pumpfun Coin">
          <p>From this point onward, the coin behaves like any other Pumpfun launch.</p>
          <p>It trades on Pumpfun's curve, can graduate on Pumpfun and distributes creator rewards according to the option selected at launch.</p>
        </Step>

        <Link href="/create" className="btn" style={{ justifySelf: 'center' }}>Launch coin</Link>
      </div>
    </main>
  );
}
