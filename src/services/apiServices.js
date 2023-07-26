export async function loadList(q, offset) {
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${q}&offset=${offset}`
  );
  return res.json();
}

export async function loadBook(q) {
  const res = await fetch(`https://openlibrary.org/works/${q}.json`);
  return res.json();
}