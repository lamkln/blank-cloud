export interface FabricVersionsResolved {
  minecraft: string;
  loader: string;
  loaderVersion: string;
  yarn: string;
  yarnVersion: string;
  loom: string;
}

interface MetaVersion {
  version: string;
  stable: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Fabric meta HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

function pickStableOrLatest(versions: MetaVersion[], preferredPrefix?: string): MetaVersion {
  const filtered = preferredPrefix
    ? versions.filter((v) => v.version.startsWith(preferredPrefix))
    : versions;
  const pool = filtered.length ? filtered : versions;
  const stable = pool.find((v) => v.stable);
  return stable ?? pool[0];
}

/** Resolve Fabric loader + yarn for a Minecraft game version using meta.fabricmc.net */
export async function resolveFabricVersions(
  minecraftVersion: string,
): Promise<FabricVersionsResolved> {
  const game = minecraftVersion.trim();
  const [loaders, yarns] = await Promise.all([
    fetchJson<{ loader: MetaVersion; intermediary: MetaVersion }[]>(
      `https://meta.fabricmc.net/v2/versions/loader/${game}`,
    ),
    fetchJson<MetaVersion[]>(`https://meta.fabricmc.net/v2/versions/yarn/${game}`),
  ]);
  if (!loaders?.length) {
    throw new Error(`No Fabric loader versions for Minecraft ${game}`);
  }
  if (!yarns?.length) {
    throw new Error(`No Yarn mappings for Minecraft ${game}`);
  }
  const loaderRow =
    loaders.find((row) => row.loader.stable) ?? loaders[0];
  const loaderEntry = loaderRow.loader;
  const yarnEntry = pickStableOrLatest(yarns);
  const loom = "1.9.2";
  return {
    minecraft: game,
    loader: loaderEntry.version,
    loaderVersion: loaderEntry.version,
    yarn: yarnEntry.version,
    yarnVersion: yarnEntry.version,
    loom,
  };
}

/** Latest Fabric API version for a Minecraft release (Maven metadata). */
export async function resolveFabricApiVersion(minecraft: string): Promise<string> {
  const url =
    "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml";
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Fabric API metadata HTTP ${res.status}`);
  }
  const xml = await res.text();
  const suffix = `+${minecraft}`;
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
    .map((m) => m[1])
    .filter((v) => v.endsWith(suffix));
  if (!versions.length) {
    throw new Error(`No fabric-api version found for Minecraft ${minecraft}`);
  }
  versions.sort();
  return versions[versions.length - 1];
}

export async function pickLatestMinecraftPatch(prefix: string): Promise<string> {
  const games = await fetchJson<MetaVersion[]>("https://meta.fabricmc.net/v2/versions/game");
  const match = games.find((g) => g.version.startsWith(prefix) && g.stable);
  if (match) return match.version;
  const any = games.find((g) => g.version.startsWith(prefix));
  if (any) return any.version;
  throw new Error(`No Minecraft version matching ${prefix}`);
}
