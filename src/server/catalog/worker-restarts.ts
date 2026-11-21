let catalogWorkerCrashes = 0;

export function recordCatalogWorkerCrash() {
  catalogWorkerCrashes += 1;

  return catalogWorkerCrashes;
}

export function catalogWorkerCrashCount() {
  return catalogWorkerCrashes;
}
