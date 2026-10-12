declare module "*.md?beacons-doc" {
  type Sub = { id: string; title: string; html: string };
  const doc: { title: string; path: string; url: string; headings: number; intro: string; sections: (Sub & { subs: Sub[] })[] };
  export default doc;
}
