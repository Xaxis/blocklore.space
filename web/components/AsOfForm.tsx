"use client";

import { momentText } from "@blocklore/core/replay";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/**
 * The time machine's control: a block height or a UTC date, and the page as Blocklore stated it
 * then (`<base>/at/<moment>`), or with `segment="since"` every change after it
 * (`<base>/since/<moment>`). With script it moves inside the app; without, the form asks
 * `<base>/<segment>?moment=`, which redirects to the same address.
 */
export function AsOfForm({
  base,
  what,
  value,
  segment = "at",
  heading: Heading = "h3",
}: {
  base: string;
  /** What the reader will see, in the sentence: "this topic", "this claim", "every topic". */
  what: string;
  /** The moment the page shows now, if it is a time machine page. */
  value?: string;
  segment?: "at" | "since";
  /** h3 in a rail under the page's h2s; h2 where no h2 comes before it. */
  heading?: "h2" | "h3";
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(value ?? "");
  return (
    <section className="rail-block" aria-labelledby={`${id}-h`}>
      <Heading id={`${id}-h`}>
        {segment === "since"
          ? value
            ? "After another moment"
            : "Since a moment"
          : value
            ? "Another moment"
            : "As it stood"}
      </Heading>
      <p>
        {segment === "since"
          ? `Only ${what} published after a block height or the end of a UTC date.`
          : `See ${what} exactly as Blocklore stated it at a past block height or UTC date.`}
      </p>
      <form
        className="asof-form"
        action={`${base}/${segment}`}
        method="get"
        onSubmit={(e) => {
          const t = momentText(text);
          if (!t) return;
          e.preventDefault();
          router.push(`${base}/${segment}/${encodeURIComponent(t)}`);
        }}
      >
        <input
          id={`${id}-m`}
          name="moment"
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={40}
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Block height or YYYY-MM-DD"
          aria-label="A block height or a UTC date, YYYY-MM-DD"
        />
        <button type="submit" className="btn btn-sm">
          Show
        </button>
      </form>
    </section>
  );
}
