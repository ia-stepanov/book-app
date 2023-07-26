import { AbstractView } from '../../common/view.js';
import { Header } from '../header/header.js';
import './page-not-found.css';

export class PageNotFound extends AbstractView {
  constructor(appState) {
    super();
    this.appState = appState;
    this.setTitle('Страница не найдена');
  }

  render() {
    const main = document.createElement('div');
    main.innerHTML = `
      <h1>Страница не найдена</h1>
      <p class="page-not-found">Вернуться на <a href="#">главную страницу</a></p>
    `;
    this.app.innerHTML = '';
    this.app.append(main);
    this.renderHeader();
  }

  renderHeader() {
    const header = new Header(this.appState).render();
    this.app.prepend(header);
  }
}
