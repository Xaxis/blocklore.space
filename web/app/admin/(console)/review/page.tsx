import { redirect } from "next/navigation";

// The review queue lives on the Evaluator page now: the evaluator decides, or the owner does when
// the switch there holds gated claims for them.
export default function ReviewPage() {
  redirect("/admin/evaluator");
}
