import { AbstractView } from '../../common/view.js';
import onChange from 'on-change';
import { Header } from '../../components/header/header.js';
import { Book } from '../../components/card-book/card-book.js';
import { loadList, loadBook } from '../../services/apiServices.js';

export class BookView extends AbstractView {
  state = {
    bookInfo: [],
    bookInfoMore: [],
    searchQuery: location.hash.split('/')[2],
    // searchQuery: location.hash.split('/')[1], // gh-pages
  };

  constructor(appState) {
    super();
    this.appState = appState;
    this.loadBook = loadBook;
    this.loadList = loadList;
    this.appState = onChange(this.appState, this.appStateHook.bind(this));
  }

  destroy() {
    onChange.unsubscribe(this.appState);
  }

  appStateHook(path) {
    if (path === 'favorites') {
      this.render();
    }
  }

  async loadInfoBook() {
    this.state.bookInfo = await this.loadBook(this.state.searchQuery);
    const list = await this.loadList(this.state.bookInfo.title);
    this.state.bookInfoMore = list.docs.find((b) => b.key === this.state.bookInfo.key);
    this.setTitle(`${this.state.bookInfo.title}`);
  }

  async render() {
    await this.loadInfoBook();
    const main = document.createElement('div');
    main.innerHTML = `<h1>${this.state.bookInfo.title}</h1>`;
    main.append(new Book(this.appState, this.state).render());
    this.app.innerHTML = '';
    this.app.append(main);
    this.renderHeader();
  }

  renderHeader() {
    const header = new Header(this.appState).render();
    this.app.prepend(header);
  }
}
