export function Article({ post }) @{
  <>
    <h1>{post.title}</h1>
    <p>{post.summary} — read in {post.minutes} minutes</p>
    @if (post.draft) {
      <mark>Draft</mark>
    }
    <hr />
  </>
}
