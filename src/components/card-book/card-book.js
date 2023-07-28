import { DivComponent } from '../../common/div-component';
import './card-book.css';
import { marked } from 'marked';

export class Book extends DivComponent {
  constructor(appState, bookState) {
    super();
    this.appState = appState;
    this.bookState = bookState.bookInfoMore;
    const {
      bookInfoMore: { cover_edition_key },
      bookInfoMore: { author_name },
      bookInfoMore: { subject_key },
      bookInfoMore: { first_publish_year },
      bookInfoMore: { number_of_pages_median },

      bookInfo: { description },
      bookInfo: { subjects },
    } = bookState;

    this.cover = cover_edition_key;
    this.author = author_name ? author_name[0] : ' ';
    this.сategory = subject_key ? subject_key[0] : ' ';
    this.firstPublishYear = first_publish_year ? first_publish_year : ' ';
    this.pages = number_of_pages_median ? number_of_pages_median : ' ';
    this.description = description;
    this.subjects = subjects ? subjects.slice(0, 12) : ' ';
  }

  #addToFavorite() {
    this.appState.favorites.push(this.bookState);
  }

  #deleteFromFavorite() {
    this.appState.favorites = this.appState.favorites.filter(
      (b) => b.key !== this.bookState.key
    );
  }

  render() {
    this.el.classList.add('book');
    const existInFavorites = this.appState.favorites.find(
      (b) => b.key === this.bookState.key
    );
    this.el.innerHTML = `
      <div class="book__header">
        <div class="book__image">
          <img src="https://covers.openlibrary.org/b/olid/${
            this.cover
          }-M.jpg" alt="Обложка" />
        </div>
        <div class="book__about">
          <p class="book__author"><span>Автор</span>: ${this.author}</p>
          <p class="book__сategory"><span>Жанр</span>: ${this.сategory}</p>
          <p class="book__year"><span>Первая публикация</span>: ${
            this.firstPublishYear
          }</p>
          <p class="book__pages"><span>Число страниц</span>: ${this.pages}</p>
          <button class="book__btn-add ${existInFavorites ? 'book__btn-active' : ''}">
            В избранное
          </button>
        </div>
      </div>
      <div class="book__body">
        <p class="book__title"><span>Описание:</span></p>
        <p class="book__descr">${
          this.description
            ? typeof this.description === 'string'
              ? marked(this.description)
              : marked(this.description.value)
            : 'Описание отсутствует'
        }</p>
      </div>
      <div class="book__footer">
        <p class="book__title"><span>Теги:</span></p>
        <ul class="book__subjects">
          ${
            Array.isArray(this.subjects)
              ? this.subjects.map((subject) => `<li>${subject}</li>`).join('')
              : ' '
          }
        </ul>
      </div>
    `;

    if (existInFavorites) {
      this.el
        .querySelector('.book__btn-active')
        .addEventListener('click', this.#deleteFromFavorite.bind(this));
    } else {
      this.el
        .querySelector('.book__btn-add')
        .addEventListener('click', this.#addToFavorite.bind(this));
    }

    return this.el;
  }
}
