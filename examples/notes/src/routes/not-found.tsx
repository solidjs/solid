import { useNavigate } from "@solidjs/router";

export default function NotFound() {
  useNavigate()("/", { replace: true });
  return null;
}
