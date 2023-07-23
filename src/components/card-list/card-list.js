import { DivComponent } from '../../common/div-component';
import { Card } from '../card/card';
import './card-list.css';

export class CardList extends DivComponent {
  constructor(appState, parrentState) {
    super();
    this.appState = appState;
    this.parrentState = parrentState;
  }

  render() {
    if (this.parrentState.loading) {
      this.el.innerHTML = `<div class="card_list__loader">Загрузка...</div>`;
      return this.el;
    }

    this.el.classList.add('card_list');
    this.el.innerHTML = `
       <h1>Найдено книг — ${this.parrentState.numFound}</h1>
    `;
    for (const card of this.parrentState.list) {
      this.el.append(new Card(this.appState, card).render());
    }

    for (const card of JSON.parse(localStorage.getItem('books'))) {
      this.el.append(new Card(this.appState, card).render());
    }
    return this.el;
  }
}
