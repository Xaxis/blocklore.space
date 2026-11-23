import Link from "next/link";
import { bipHref } from "@/lib/bips";

/** "BIP n, title" as the index writes it, linked to the BIP's page while the index lists it. */
export function BipName({ n, title }: { n: number; title: string }) {
  const href = bipHref(n);
  const name = `BIP ${n}, ${title}`;
  return href ? <Link href={href}>{name}</Link> : name;
}
