// Импортируем компонент
import { MainView } from './views/main/main';
import { FavoritesView } from './views/favorites/favorites';
import { BookView } from './views/book/book';
import { PageNotFound } from './components/page-not-found/page-not-found';

// Основной класс приложения
class App {
  // Массив маршрутов
  routes = [
    { path: '', view: MainView },
    { path: '#favorites', view: FavoritesView },
    { path: '#books/:id', view: BookView },
  ];

  // Глобальный State для работы с Favorites
  appState = {
    favorites: [],
    list: [],
    numFound: 0,
  };

  constructor() {
    // Подписываемся на событие изменения URL-адреса
    window.addEventListener('hashchange', this.route.bind(this));

    // Вызываем маршрутизацию
    this.route();
  }

  // Метод для обработки маршрутов
  route() {
    // Если страница уже отрисована, вызываем метод destroy
    if (this.currentView) {
      this.currentView.destroy();
    }

    // Находим маршрут в массиве маршрутов по URL-адресу
    // const view = this.routes.find((r) => r.path === location.hash).view;

    try {
      // Находим маршрут в массиве маршрутов по URL-адресу
      const view = this.routes.find((route) => {
        // Разбиваем путь маршрута и URL-адрес на части
        const routeParts = route.path.split('/');
        const pathParts = location.hash.split('/');

        // Проверяем, что первая часть пути маршрута соответствует первой части URL-адреса
        const routeIsValid = routeParts[0] === pathParts[0];

        // Проверяем, что вторая часть URL-адреса соответствует шаблону
        // (два символа алфавита и четыре цифры)
        const pathIsValid = /^[A-Za-z]{2}\d{4}/.test(pathParts[1]);

        // Проверяем, что URL-адрес не состоит более чем из двух частей
        const pathIsNotTooLong = pathParts.length <= 2;

        // Если URL-адрес слишком длинный, выбрасываем исключение
        if (!pathIsNotTooLong) {
          throw new Error('Invalid path');
        }

        // Возвращаем результат, если путь маршрута и URL-адрес проходят проверку
        return routeIsValid && (pathParts.length === 1 || pathIsValid);
      }).view;

      // Создаём экземпляр класса для отрисовки страницы
      this.currentView = new view(this.appState);

      // Вызываем render, чтобы отрисовать страницу
      this.currentView.render();
    } catch (error) {
      // Если маршрут не найден, делаем редирект на главную страницу
      this.currentView = new PageNotFound(this.appState);
      this.currentView.render();
    }
  }
}

// Запускаем наше приложение
new App();
