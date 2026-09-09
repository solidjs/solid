import {} from "@solidjs/web";
import {} from "@solidjs/web/jsx-runtime";
import {} from "@solidjs/web/jsx-dev-runtime";
import {} from "@solidjs/web/storage";
// Note: @solidjs/web/server-functions, /serialization and /frames types are
// not importable under NodeNext resolution without skipLibCheck — their type
// chain reaches seroval, whose published .d.ts uses extensionless relative
// imports (TS2834 under node16/nodenext). Upstream seroval limitation,
// tracked separately; unrelated to this package's module format.
