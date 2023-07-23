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

    const cardGrid = document.createElement('div');
    cardGrid.classList.add('card_grid');
    this.el.append(cardGrid);

    for (const card of this.parrentState.list) {
      cardGrid.append(new Card(this.appState, card).render());
    }

    return this.el;
  }
}
