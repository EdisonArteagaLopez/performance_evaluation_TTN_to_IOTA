export function perfStart() {
    return {
      t0: Date.now(),
      cpu0: process.cpuUsage(),
      mem0: process.memoryUsage(),
    };
  }
  
  export function perfEnd(p0) {
    const t1 = Date.now();
    const cpu1 = process.cpuUsage(p0.cpu0); // delta microseconds
    const mem1 = process.memoryUsage();
  
    return {
      ms_total: t1 - p0.t0,
      cpu_user_ms: cpu1.user / 1000,
      cpu_system_ms: cpu1.system / 1000,
      rss_bytes: mem1.rss,
      heapUsed_bytes: mem1.heapUsed,
      external_bytes: mem1.external,
    };
  }