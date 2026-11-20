import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap not-found">
      <p className="eyebrow">404</p>
      <h1 style={{ fontSize: "2.4rem", margin: "0.5rem 0 1rem" }}>No such page</h1>
      <p className="lede">
        Nothing is published at this address. If a claim was here, it was not removed silently:{" "}
        <Link href="/changes">the change log</Link> has every revision.
      </p>
    </div>
  );
}
