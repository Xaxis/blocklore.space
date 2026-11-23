/** The path every claim takes, and who does each step: a model, code, or the owner. */
export function Flow() {
  const steps = [
    {
      who: "model",
      label: "A model",
      title: "Research",
      text: "Reads the code, the BIPs, the chain and the archives, and drafts claims with exact quotes.",
    },
    {
      who: "code",
      label: "Code",
      title: "Check",
      text: "Fetches every link, finds every quote, runs every check against the chain and the code.",
    },
    {
      who: "model",
      label: "A second model",
      title: "Falsify",
      text: "With fresh context and no stake in the draft, tries to break each claim.",
    },
    {
      who: "code",
      label: "Code",
      title: "Gate",
      text: "Marks contested subjects, safety advice, stances, arguments and named people for closer checks.",
    },
    {
      who: "code",
      label: "Code and two models",
      title: "Evaluate",
      text: "Checks the marked claims again, applies the editorial rules, and needs two verifiers on different models to accept. Test claims prove it still catches errors.",
    },
    {
      who: "code",
      label: "Code",
      title: "Publish",
      text: "Commits, hashes and logs every change with what it replaced, at a block height.",
    },
    {
      who: "person",
      label: "The owner",
      title: "Oversee",
      text: "Can withdraw any claim with a reason, kept as a revision, or hold marked claims for their own approval.",
    },
  ];
  return (
    <ol className="flow plain-list">
      {steps.map((s) => (
        <li key={s.title} style={{ display: "contents" }}>
          <div>
            <span className={`who ${s.who}`}>{s.label}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
