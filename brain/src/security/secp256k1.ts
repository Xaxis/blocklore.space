// libsecp256k1's own tests in the lab (BACKLOG 40): every signature a Bitcoin Core node checks goes
// through libsecp256k1, so for each release the lab builds the library's own test programs from
// the copy that release ships in src/secp256k1 and runs them. The source tarball is listed in the
// release's SHA256SUMS, which the builders sign, and the lab extracts it only after it matched: a
// pass means "the libsecp256k1 your node of this release runs passes its own tests".
//
// The machine has gcc and make but no cmake, so the lab reads the release's own CMake files and
// builds with gcc what they would build, with the modules and defines Core turns on:
//
//   cmake/secp256k1.cmake            Core's settings for its subtree (the same in 30.5, 31.3, 32.1):
//                                      14  set(CMAKE_C_VISIBILITY_PRESET hidden)
//                                      17  set(SECP256K1_ENABLE_MODULE_ECDH OFF CACHE BOOL "" FORCE)
//                                      18  set(SECP256K1_ENABLE_MODULE_RECOVERY ON CACHE BOOL "" FORCE)
//                                      19  set(SECP256K1_ENABLE_MODULE_MUSIG ON CACHE BOOL "" FORCE)
//                                      21  set(SECP256K1_BUILD_TESTS ${BUILD_TESTS} CACHE BOOL "" FORCE)
//                                      22  set(SECP256K1_BUILD_EXHAUSTIVE_TESTS ${BUILD_TESTS} ...)
//                                      39  "the most tested RelWithDebInfo configuration": every
//                                          build type gets CMAKE_C_FLAGS_RELWITHDEBINFO, which is
//                                          CMake's "-O2 -g -DNDEBUG" for GCC
//   src/secp256k1/CMakeLists.txt     the library's defaults (lines as in 32.1):
//                                      31  set(CMAKE_C_STANDARD 90), 32 CMAKE_C_EXTENSIONS OFF
//                                      49  to 55, option(SECP256K1_ENABLE_MODULE_<X> ... ON|OFF):
//                                          extrakeys, schnorrsig and ellswift on (and silent
//                                          payments in 32.1), the ones Core leaves alone
//                                      62, 66  ECMULT_WINDOW_SIZE=15
//                                      68, 77 to 79  ECMULT_GEN_KB 86: COMB_BLOCKS=43, COMB_TEETH=6
//                                      91, 108  SECP256K1_ASM "AUTO": USE_ASM_X86_64=1 on x86_64
//                                      123  SECP256K1_VALGRIND "AUTO": off, the box has no
//                                           valgrind/memcheck.h (it only feeds ctime_tests)
//                                      154  -DNDEBUG removed from RelWithDebInfo: "-O2 -g"
//   src/secp256k1/src/CMakeLists.txt which modules pull in which, and the test programs:
//                                      10 to 55  each enabled module's ENABLE_MODULE_<X>=1, musig
//                                                turning on schnorrsig, schnorrsig (and silent
//                                                payments) extrakeys
//                                      57  secp256k1_precomputed: precomputed_ecmult.c and
//                                          precomputed_ecmult_gen.c, compiled on their own
//                                      122 to 153  noverify_tests and tests from tests.c with the
//                                          precomputed tables, tests with VERIFY, both with
//                                          SUPPORTS_CONCURRENCY=1 (31.3 and later)
//                                      155 to 164  exhaustive_tests from tests_exhaustive.c with
//                                          VERIFY and tables made at run time
//
// secpBuild reads those lines from the release's files rather than copying them here, so a release
// that changes a module changes what the lab builds; a file it cannot read the same way is a build
// error, which the disclosure gate holds like any failed test.
//
// Each program then runs as secp256k1's defaults have it: no arguments, so 16 iterations for tests
// and noverify_tests and 2 for exhaustive_tests, a random seed each prints, one process. Under
// `heavy`, each step with a time limit.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type LabTest,
  SECP256K1_PREFIX,
  SECP256K1_PROGRAMS,
  type Secp256k1Program,
} from "@blocklore/core";

const HEAVY = path.join(os.homedir(), ".claude", "claude-core", "bin", "heavy");
const TIME = "/usr/bin/time";
/** Each gcc call, and each program's run, at most this long once it holds a slot. */
const BUILD_LIMIT_S = 15 * 60;
const RUN_LIMIT_S = 60 * 60;

/** The release's three CMake files the build is read from, as text. */
export interface SecpCmake {
  /** cmake/secp256k1.cmake: Core's settings for the subtree. */
  core: string;
  /** src/secp256k1/CMakeLists.txt: the library's options and their defaults. */
  top: string;
  /** src/secp256k1/src/CMakeLists.txt: the modules' order and the test programs. */
  src: string;
}

export interface SecpProgram {
  name: Secp256k1Program;
  /** Its source file in src/secp256k1/src. */
  source: string;
  /** Its own defines: VERIFY, SUPPORTS_CONCURRENCY=1. */
  defines: string[];
  /** Linked with the precomputed tables (exhaustive_tests makes its own at run time). */
  precomputed: boolean;
}

export interface SecpBuild {
  /** libsecp256k1's version in the subtree's project(). */
  version: string;
  /** The modules compiled in, in the order CMake turns them on. */
  modules: string[];
  /** Compiler flags: the C standard, RelWithDebInfo's optimization, the visibility. */
  flags: string[];
  /** Defines every file gets, as CMake's add_compile_definitions. */
  defines: string[];
  /** The precomputed tables' sources. */
  precomputed: string[];
  /** The test programs the release has, of the ones the lab knows. */
  programs: SecpProgram[];
}

const need = (m: RegExpExecArray | RegExpMatchArray | null, what: string): RegExpMatchArray => {
  if (!m) throw new Error(`the release's CMake files do not say ${what} the way the lab reads it`);
  return m;
};

/** CMake functions expanded at each call, so a program declared through one reads as any other. */
function expandFunctions(text: string): string {
  let out = text;
  for (const f of text.matchAll(
    /^[ \t]*function\((\w+)((?:[ \t]+\w+)*)\)\n([\s\S]*?)^[ \t]*endfunction\(\)/gm,
  )) {
    const [whole, name = "", rawParams = "", body = ""] = f;
    const params = rawParams.trim().split(/\s+/).filter(Boolean);
    out = out.replace(whole, "");
    out = out.replace(new RegExp(`^[ \\t]*${name}\\(([^)]*)\\)`, "gm"), (_m, args: string) => {
      const values = [...args.matchAll(/"([^"]*)"|(\S+)/g)].map((a) => a[1] ?? a[2] ?? "");
      return params.reduce((b, p, i) => b.replaceAll(`\${${p}}`, values[i] ?? ""), body);
    });
  }
  return out;
}

/**
 * What Core's build compiles for its secp256k1 subtree, from the release's own CMake files (the
 * lines are cited at the top of this file), for this machine's architecture.
 */
export function secpBuild(files: SecpCmake, arch = process.arch): SecpBuild {
  const version = need(
    /project\(libsecp256k1[\s\S]*?VERSION (\d+\.\d+\.\d+)/.exec(files.top),
    "libsecp256k1's version",
  )[1] as string;

  // Core builds the subtree as RelWithDebInfo whatever its own build type is.
  need(/CMAKE_C_FLAGS_RELWITHDEBINFO/.exec(files.core), "the subtree's build type");
  // CMake's RelWithDebInfo for GCC is "-O2 -g -DNDEBUG"; the library takes -DNDEBUG out.
  const ndebug = !/REGEX REPLACE "-DNDEBUG[^"]*" "" CMAKE_C_FLAGS_RELWITHDEBINFO/.test(files.top);
  const std = need(/set\(CMAKE_C_STANDARD (\d+)\)/.exec(files.top), "the C standard")[1];
  const ext = /set\(CMAKE_C_EXTENSIONS ON\)/.test(files.top);
  const visibility = /set\(CMAKE_C_VISIBILITY_PRESET (\w+)\)/.exec(files.core)?.[1];
  const flags = [
    `-std=${ext ? "gnu" : "c"}${std}`,
    "-O2",
    "-g",
    ...(ndebug ? ["-DNDEBUG"] : []),
    ...(visibility ? [`-fvisibility=${visibility}`] : []),
  ];

  const defines: string[] = [];
  const window = need(
    /set\(SECP256K1_ECMULT_WINDOW_SIZE (\d+) CACHE/.exec(files.top),
    "the ecmult window",
  )[1];
  need(
    /add_compile_definitions\(ECMULT_WINDOW_SIZE=\$\{SECP256K1_ECMULT_WINDOW_SIZE\}\)/.exec(
      files.top,
    ),
    "the ecmult window's define",
  );
  defines.push(`ECMULT_WINDOW_SIZE=${window}`);
  const kb = need(
    /set\(SECP256K1_ECMULT_GEN_KB (\d+) CACHE/.exec(files.top),
    "the signing table's size",
  )[1];
  const comb = need(
    new RegExp(
      `if\\(SECP256K1_ECMULT_GEN_KB EQUAL ${kb}\\)\\s*add_compile_definitions\\(COMB_BLOCKS=(\\d+)\\)\\s*add_compile_definitions\\(COMB_TEETH=(\\d+)\\)`,
    ).exec(files.top),
    `the comb for a ${kb} KiB table`,
  );
  defines.push(`COMB_BLOCKS=${comb[1]}`, `COMB_TEETH=${comb[2]}`);
  const asm = need(/set\(SECP256K1_ASM "(\w+)" CACHE/.exec(files.top), "the assembly")[1];
  if (arch === "x64" && (asm === "AUTO" || asm === "x86_64")) {
    need(/add_compile_definitions\(USE_ASM_X86_64=1\)/.exec(files.top), "the x86_64 assembly");
    defines.push("USE_ASM_X86_64=1");
  }

  // Modules: the library's defaults, Core's forced values over them, then src/CMakeLists.txt's
  // blocks in its order, each enabled one turning on what it depends on.
  const on = new Map<string, boolean>();
  for (const m of files.top.matchAll(/option\((SECP256K1_ENABLE_MODULE_\w+) "[^"]*" (ON|OFF)\)/g))
    on.set(m[1] as string, m[2] === "ON");
  if (!on.size) throw new Error("the release's CMake files list no libsecp256k1 module");
  for (const m of files.core.matchAll(
    /set\((SECP256K1_ENABLE_MODULE_\w+) (ON|OFF) CACHE BOOL "" FORCE\)/g,
  ))
    on.set(m[1] as string, m[2] === "ON");
  const modules: string[] = [];
  const blocks = [
    ...files.src.matchAll(/^if\((SECP256K1_ENABLE_MODULE_\w+)\)\n([\s\S]*?)^endif\(\)/gm),
  ];
  for (const [, option = "", body = ""] of blocks) {
    if (!on.get(option)) continue;
    for (const dep of body.matchAll(/set\((SECP256K1_ENABLE_MODULE_\w+) ON\)/g)) {
      // CMake stops with "Module dependency error" when a module another needs was turned off.
      if (on.get(dep[1] as string) === false)
        throw new Error(`${option} needs ${dep[1]}, which the build turns off`);
      on.set(dep[1] as string, true);
    }
    const def = need(
      /add_compile_definitions\((ENABLE_MODULE_\w+=1)\)/.exec(body),
      `${option}'s define`,
    )[1] as string;
    modules.push(def.replace(/^ENABLE_MODULE_(\w+)=1$/, "$1").toLowerCase());
    defines.push(def);
  }
  const unread = [...on].filter(([o, v]) => v && !blocks.some((b) => b[1] === o));
  if (unread.length)
    throw new Error(`no block in src/CMakeLists.txt turns on ${unread.map(([o]) => o)}`);

  const precomputed = need(
    /add_library\(secp256k1_precomputed OBJECT EXCLUDE_FROM_ALL\s+([^)]*)\)/.exec(files.src),
    "the precomputed tables",
  )[1]
    ?.trim()
    .split(/\s+/) as string[];
  // Appended when sys/types.h, sys/wait.h and unistd.h exist, as they do on Linux.
  const testDefs = [...files.src.matchAll(/list\(APPEND TEST_DEFINITIONS (\S+)\)/g)].map(
    (m) => m[1] as string,
  );

  const src = expandFunctions(files.src);
  const programs: SecpProgram[] = [];
  for (const m of src.matchAll(/^[ \t]*add_executable\((\w+) (\w+\.c)\)/gm)) {
    const name = m[1] as Secp256k1Program;
    if (!SECP256K1_PROGRAMS.includes(name) || programs.some((p) => p.name === name)) continue;
    const own: string[] = [];
    for (const d of src.matchAll(
      new RegExp(`target_compile_definitions\\(${name} PRIVATE([^)]*)\\)`, "g"),
    ))
      for (const token of (d[1] ?? "").trim().split(/\s+/).filter(Boolean)) {
        if (token === "VERIFY") own.push("VERIFY");
        else if (/^\$\{TEST_DEFINITIONS\}$/.test(token)) own.push(...testDefs);
        // Core builds RelWithDebInfo, never the Coverage build type.
        else if (token === "$<$<NOT:$<CONFIG:Coverage>>:VERIFY>") own.push("VERIFY");
        else if (token !== '""') throw new Error(`${name}: unknown define ${token}`);
      }
    const links = [
      ...src.matchAll(new RegExp(`target_link_libraries\\(${name} ([^)]*)\\)`, "g")),
    ].flatMap((l) => (l[1] ?? "").trim().split(/\s+/));
    programs.push({
      name,
      source: m[2] as string,
      defines: [...new Set(own)],
      precomputed: links.includes("secp256k1_precomputed"),
    });
  }
  if (!programs.length)
    throw new Error("src/CMakeLists.txt declares no test program the lab knows");
  return { version, modules, flags, defines, precomputed, programs };
}

/** The release's CMake files, from its extracted source. */
export function readSecpCmake(src: string): SecpCmake {
  return {
    core: readFileSync(path.join(src, "cmake", "secp256k1.cmake"), "utf8"),
    top: readFileSync(path.join(src, "src", "secp256k1", "CMakeLists.txt"), "utf8"),
    src: readFileSync(path.join(src, "src", "secp256k1", "src", "CMakeLists.txt"), "utf8"),
  };
}

export interface GccCommand {
  /** What it makes: "precomputed" or a program's name. */
  step: string;
  /** gcc's arguments. */
  argv: string[];
}

/**
 * The gcc calls that build the programs: the precomputed tables first, as objects of their own
 * (CMake's OBJECT library, without a program's defines), then each program from its one source,
 * which includes the library itself, linked with the tables when it uses them.
 */
export function secpCommands(
  build: SecpBuild,
  dirs: { secp: string; out: string },
  programs: readonly Secp256k1Program[] = build.programs.map((p) => p.name),
): GccCommand[] {
  const base = [...build.flags, ...build.defines.map((d) => `-D${d}`)];
  const objects = build.precomputed.map((f) => path.join(dirs.out, f.replace(/\.c$/, ".o")));
  const out: GccCommand[] = [];
  if (build.programs.some((p) => p.precomputed && programs.includes(p.name)))
    out.push({
      step: "precomputed",
      // Run in the build folder, so each object lands there under its own name.
      argv: [...base, "-c", ...build.precomputed.map((f) => path.join(dirs.secp, "src", f))],
    });
  for (const p of build.programs.filter((x) => programs.includes(x.name)))
    out.push({
      step: p.name,
      argv: [
        ...base,
        ...p.defines.map((d) => `-D${d}`),
        "-o",
        path.join(dirs.out, p.name),
        path.join(dirs.secp, "src", p.source),
        ...(p.precomputed ? objects : []),
      ],
    });
  return out;
}

/**
 * Whether a program passed, from its exit and its own last words: tests.c before 31.0 and
 * tests_exhaustive.c print "no problems found", the unit test framework of 31.0 and later "Total
 * execution time: N seconds", each only after every test ran. A failed check aborts the program.
 */
export function secpPassed(output: string, exit: number | null): boolean {
  return (
    exit === 0 &&
    (/^no problems found$/m.test(output) || /^Total execution time: [\d.]+ seconds$/m.test(output))
  );
}

/** GNU time's -o file: a status line when the command failed, then the seconds. */
export function timeSeconds(text: string): number | null {
  const last = text.trim().split("\n").at(-1) ?? "";
  return /^\d+(\.\d+)?$/.test(last) ? Number(last) : null;
}

/**
 * One step under heavy with a time limit: its exit, its seconds once it held a slot, its output.
 * LND's `go test` runs (lnd.ts) take the same path.
 */
export function step(
  argv: string[],
  o: { cwd: string; log: string; limit: number; env: NodeJS.ProcessEnv },
): Promise<{ exit: number | null; seconds: number; output: string }> {
  const timeFile = `${o.log}.time`;
  rmSync(timeFile, { force: true });
  const timed = existsSync(TIME) ? [TIME, "-f", "%e", "-o", timeFile] : [];
  const full = [...timed, "timeout", "-k", "30", String(o.limit), ...argv];
  const [cmd, args] = existsSync(HEAVY) ? [HEAVY, full] : [full[0] as string, full.slice(1)];
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const out = createWriteStream(o.log);
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", reject);
    child.on("close", (code) =>
      out.end(() => {
        const t = existsSync(timeFile) ? timeSeconds(readFileSync(timeFile, "utf8")) : null;
        resolve({
          exit: code,
          seconds: Math.round((t ?? (Date.now() - started) / 1000) * 10) / 10,
          output: readFileSync(o.log, "utf8"),
        });
      }),
    );
  });
}

/** What the owner sees of the build and each program, privately. */
export interface SecpRecord {
  version: string | null;
  modules: string[];
  commands: string[];
  /** The build's seconds: every gcc call. */
  build: number;
  error: string | null;
  programs: { name: string; ok: boolean; exit: number | null; seconds: number; tail: string }[];
}

const tailOf = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n");

/**
 * Builds and runs the programs asked for, from a release's extracted source, in `dir` (wiped
 * first). A program that does not build, or a build the lab cannot read, fails like a test.
 */
export async function runSecp256k1(input: {
  src: string;
  dir: string;
  programs: readonly Secp256k1Program[];
  env: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}): Promise<{ tests: LabTest[]; missing: string[]; record: SecpRecord }> {
  const say = input.log ?? (() => {});
  const record: SecpRecord = {
    version: null,
    modules: [],
    commands: [],
    build: 0,
    error: null,
    programs: [],
  };
  const failAll = (names: readonly string[], error: string) => {
    record.error = error;
    say(`lab: libsecp256k1 did not build: ${error}`);
    return names.map((n) => ({ name: `${SECP256K1_PREFIX}${n}`, ok: false, seconds: 0 }));
  };
  let build: SecpBuild;
  try {
    build = secpBuild(readSecpCmake(input.src));
  } catch (e) {
    return { tests: failAll(input.programs, (e as Error).message), missing: [], record };
  }
  const has = new Set(build.programs.map((p) => p.name));
  const wanted = input.programs.filter((p) => has.has(p));
  const missing = input.programs.filter((p) => !has.has(p)).map((p) => `${SECP256K1_PREFIX}${p}`);
  record.version = build.version;
  record.modules = build.modules;
  rmSync(input.dir, { recursive: true, force: true });
  mkdirSync(input.dir, { recursive: true });
  const secp = path.join(input.src, "src", "secp256k1");
  const commands = secpCommands(build, { secp, out: input.dir }, wanted);
  record.commands = commands.map((c) => ["gcc", ...c.argv].join(" "));
  say(
    `lab: libsecp256k1 ${build.version} from Bitcoin Core's src/secp256k1, modules ${build.modules.join(", ")}`,
  );

  const built = new Set<string>();
  let failed: string | null = null;
  for (const c of commands) {
    if (failed) break;
    const r = await step(["gcc", ...c.argv], {
      cwd: input.dir,
      log: path.join(input.dir, `build-${c.step}.log`),
      limit: BUILD_LIMIT_S,
      env: input.env,
    });
    record.build = Math.round((record.build + r.seconds) * 10) / 10;
    if (r.exit === 0) built.add(c.step);
    else failed = `gcc for ${c.step} exited ${r.exit}: ${tailOf(r.output, 20)}`;
  }
  if (failed) record.error = failed;
  say(
    `lab: libsecp256k1 built in ${record.build} s${failed ? `; FAILED: ${failed.split("\n")[0]}` : ""}`,
  );

  const tests: LabTest[] = [];
  for (const name of wanted) {
    const test = `${SECP256K1_PREFIX}${name}`;
    if (!built.has(name)) {
      tests.push({ name: test, ok: false, seconds: 0 });
      record.programs.push({ name: test, ok: false, exit: null, seconds: 0, tail: "not built" });
      continue;
    }
    const r = await step([path.join(input.dir, name)], {
      cwd: input.dir,
      log: path.join(input.dir, `${name}.log`),
      limit: RUN_LIMIT_S,
      env: input.env,
    });
    const ok = secpPassed(r.output, r.exit);
    tests.push({ name: test, ok, seconds: r.seconds });
    record.programs.push({
      name: test,
      ok,
      exit: r.exit,
      seconds: r.seconds,
      tail: tailOf(r.output, 40),
    });
    say(`lab: ${test} ${ok ? "passed" : `FAILED (exit ${r.exit})`} in ${r.seconds} s`);
  }
  return { tests, missing, record };
}
