import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/CopyCommand";
import { Block, Page, PageHeader } from "@/components/ui";
import { followChannel } from "@/lib/data";
import { MCP_SERVER } from "@/lib/mcp";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Connect your model",
  description:
    "Blocklore runs no model for readers. Connect your own assistant to its MCP server and it reads the same cited, checked claims this site shows.",
  alternates: { canonical: "/connect" },
};

const MCP = `${SITE.url}/mcp`;

const CLIENTS: { name: string; how: string; command?: string; config?: string }[] = [
  {
    name: "Claude Code",
    how: "In a terminal:",
    command: `claude mcp add --transport http blocklore ${MCP}`,
  },
  {
    name: "Claude (desktop and web)",
    how: "Settings, Connectors, Add custom connector, with this URL:",
    command: MCP,
  },
  {
    name: "Cursor",
    how: "In .cursor/mcp.json:",
    config: JSON.stringify({ mcpServers: { blocklore: { url: MCP } } }, null, 2),
  },
  {
    name: "VS Code",
    how: "In .vscode/mcp.json:",
    config: JSON.stringify({ servers: { blocklore: { type: "http", url: MCP } } }, null, 2),
  },
  {
    name: "Anything else",
    how: "Any client that speaks MCP over streamable HTTP; no key, no account:",
    command: MCP,
  },
];

export default function ConnectPage() {
  const channel = followChannel();
  return (
    <Page>
      <PageHeader
        title="Connect your model"
        lede="Blocklore runs no model for readers. Bring your own: connect your assistant to Blocklore's MCP server and it answers from the same published claims you see here, with their sources and the block heights they were checked at."
      />

      <Block id="clients" title="Add it to your assistant">
        {CLIENTS.map((c) => (
          <div className="client" key={c.name}>
            <h3>{c.name}</h3>
            <p className="small muted">{c.how}</p>
            {c.command && <CopyCommand command={c.command} />}
            {c.config && <pre className="code">{c.config}</pre>}
          </div>
        ))}
      </Block>

      <Block id="tools" title="What your model can read">
        <p className="small muted" style={{ marginBottom: "var(--s4)" }}>
          Every tool returns data: claims with their sources, quotes and status. Your model does the
          reading and the writing, and you see what it cites.
        </p>
        <dl className="dl stacked">
          {MCP_SERVER.tools.flatMap((t) => [
            <dt key={`${t.name}-t`} className="mono">
              {t.name}
            </dt>,
            <dd key={`${t.name}-d`}>{t.description}</dd>,
          ])}
        </dl>
      </Block>

      <Block id="rules" title="Keep your model honest">
        <ul className="stack-sm" style={{ paddingLeft: "1.1rem" }}>
          <li>
            Ask it to cite claim ids and to say when Blocklore has no claim on a question. Each id
            opens at <span className="mono">{SITE.url}/claims/&lt;id&gt;</span> with its sources.
          </li>
          <li>
            Contested claims carry their status and who holds each position. A model that turns them
            into one answer is going past what the claims say.
          </li>
          <li>
            Missing something? <Link href="/gaps#suggest">Suggest it</Link> for research.
          </li>
        </ul>
      </Block>

      {channel && (
        <Block id="nostr" title="Follow on Nostr">
          <p className="small muted" style={{ marginBottom: "var(--s4)" }}>
            Blocklore posts to Nostr too, so what it learns reaches you without this website: the
            daily digest as a long-form article, a note when an edition is sealed in a Bitcoin
            block, and the security watch&apos;s changes. Code builds every note from the published
            claims, each with its link and its sources. No model writes them.
          </p>
          <div className="stack">
            <div className="toolbar">
              <a className="btn btn-primary" href={`nostr:${channel.npub}`}>
                Follow on Nostr
              </a>
              <span className="small muted">
                Opens your Nostr client. Or search for <span className="mono">blocklore.space</span>{" "}
                in it.
              </span>
            </div>
            <CopyCommand label="npub" command={channel.npub} />
            <dl className="dl stacked">
              <dt>NIP-05</dt>
              <dd className="mono small">_@blocklore.space</dd>
              <dt>Relays</dt>
              <dd className="mono small">{channel.relays.join(", ")}</dd>
              <dt>Check a note</dt>
              <dd className="small">
                Every note is signed by this key, which{" "}
                <a href="/.well-known/nostr.json">blocklore.space names</a>; every claim in it links
                to its page here, with its sources and its hash.
              </dd>
            </dl>
          </div>
        </Block>
      )}

      <Block id="other" title="Other ways in">
        <ul className="stack-sm" style={{ paddingLeft: "1.1rem" }}>
          <li>
            The JSON API and the full export: <Link href="/about/api">API and data</Link>.
          </li>
          <li>
            For crawlers and context windows: <a href="/llms.txt">llms.txt</a> and{" "}
            <a href="/llms-full.txt">llms-full.txt</a>.
          </li>
          <li>
            The store itself, as YAML in git: <a href={SITE.repo}>the repository</a>.
          </li>
        </ul>
      </Block>
    </Page>
  );
}
