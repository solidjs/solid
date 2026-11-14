(globalThis as any).THIN_STORE = true;
if (process.env.THIN_LEAK) (globalThis as any).THIN_LEAK = true;
