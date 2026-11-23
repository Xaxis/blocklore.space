import {
  type BitRow,
  bitRows,
  CHAINPARAMS,
  chainparamsDeployments,
  DEPLOYMENT_BITS,
  deploymentUrl,
  PERIOD,
  type PeriodTally,
  type Signaling,
  share,
} from "@blocklore/core";
import Link from "next/link";
import { TableWrap } from "@/components/TableWrap";
import { Block } from "@/components/ui";
import { dateTime, height } from "@/lib/format";

// The version bits blocks set this period and the last (core/src/signaling.ts): counts and their
// shares of the blocks counted, never a forecast. BIP 320's bits 13 to 28 are counted apart and
// never shown as signaling; a deployment's name shows beside its bit only when Bitcoin Core's
// mainnet chainparams at the pinned commit defines it.

const n = (x: number) => x.toLocaleString("en-US");

function Count({ count, of }: { count: number; of: number }) {
  return (
    <td className="num">
      {n(count)}
      <span className="share">{share(count, of)}%</span>
    </td>
  );
}

function BitLabel({ r }: { r: BitRow }) {
  return (
    <th scope="row">
      Bit {r.bit}
      {r.deployment && (
        <>
          {" "}
          <a href={r.deployment.url} className="mono" rel="noopener noreferrer">
            {r.deployment.name}
          </a>
        </>
      )}
    </th>
  );
}

/**
 * The block on /proposals and on a BIP's page. `only` limits it to these bits' rows (a BIP whose
 * deployment chainparams defines); without it, the whole tally.
 */
export function VersionBits({ s, only }: { s: Signaling; only?: BitRow[] }) {
  const prev = s.previous;
  const periods: PeriodTally[] = prev ? [s.current, prev] : [s.current];
  const rows = only ?? bitRows(s);
  const { onDeploymentBits } = chainparamsDeployments();
  const all = CHAINPARAMS.deployments;
  return (
    <Block
      id="version-bits"
      title="Version bits this period"
      aside={
        <p>
          As of block {height(s.tip.height)}, mined {dateTime(s.tip.time)}
        </p>
      }
    >
      <p className="small muted block-note">
        Heights {height(s.current.start)} to {height(s.current.end)}, {n(s.current.blocks)} of{" "}
        {n(PERIOD)} blocks so far. Shares are of the blocks counted in each period.
      </p>
      <TableWrap label="Version bits this period">
        <table className="table vbits">
          <thead>
            <tr>
              <th scope="col">Blocks</th>
              <th scope="col" className="num">
                This period
                <span className="share">from {height(s.current.start)}</span>
              </th>
              {prev && (
                <th scope="col" className="num">
                  Last period
                  <span className="share">from {height(prev.start)}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {!only && (
              <>
                <tr>
                  <th scope="row">Counted</th>
                  {periods.map((p) => (
                    <td key={p.start} className="num">
                      {n(p.blocks)}
                      <span className="share">of {n(PERIOD)}</span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">
                    With <Link href="/proposals/9">BIP 9</Link>'s top bits 001
                  </th>
                  {periods.map((p) => (
                    <Count key={p.start} count={p.prefixed} of={p.blocks} />
                  ))}
                </tr>
              </>
            )}
            {rows.length > 0 ? (
              rows.map((r) => (
                <tr key={r.bit}>
                  <BitLabel r={r} />
                  <Count count={r.current.blocks} of={s.current.blocks} />
                  {prev && r.previous && <Count count={r.previous.blocks} of={prev.blocks} />}
                </tr>
              ))
            ) : (
              <tr>
                <th scope="row">Bits 0 to {DEPLOYMENT_BITS - 1}</th>
                <td colSpan={periods.length}>No block set a deployment bit</td>
              </tr>
            )}
            {!only && (
              <>
                <tr>
                  <th scope="row">
                    Setting any of <Link href="/proposals/320">BIP 320</Link>'s bits 13 to 28, not a
                    signal
                  </th>
                  {periods.map((p) => (
                    <Count key={p.start} count={p.general} of={p.blocks} />
                  ))}
                </tr>
                <tr>
                  <th scope="row">Without the prefix, so every bit reads as 0</th>
                  {periods.map((p) => (
                    <Count key={p.start} count={p.unprefixed} of={p.blocks} />
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </TableWrap>
      <p className="small muted">
        A block signals under <Link href="/proposals/9">BIP 9</Link> only when its version's top
        three bits are 001, on one of bits 0 to {DEPLOYMENT_BITS - 1};{" "}
        <Link href="/proposals/320">BIP 320</Link> reserves bits 13 to 28 for general use such as
        version rolling. Bitcoin Core {CHAINPARAMS.release}'s mainnet parameters (
        <a
          href={`https://github.com/bitcoin/bitcoin/blob/${CHAINPARAMS.commit}/${CHAINPARAMS.file}`}
          rel="noopener noreferrer"
        >
          chainparams.cpp
        </a>
        ) define{" "}
        {all.length === 0
          ? "no deployment"
          : all.length === 1
            ? "one deployment, "
            : `${all.length} deployments: `}
        {all.map((d, i) => (
          <span key={d.name}>
            {i > 0 && "; "}
            <a href={deploymentUrl(d)} className="mono" rel="noopener noreferrer">
              {d.name}
            </a>{" "}
            on bit {d.bit}, start time <span className="mono">{d.start.split("::").at(-1)}</span>
          </span>
        ))}
        {all.length > 0 && onDeploymentBits.length === 0
          ? `, and none on bits 0 to ${DEPLOYMENT_BITS - 1}`
          : ""}
        . Versions read from mempool.space and blockstream.info, which must agree on every block;{" "}
        {prev ? "" : "the last period shows once the brain has followed one to its end; "}
        <Link href="/api/v1/signaling">as JSON</Link>.
      </p>
    </Block>
  );
}
