// Импортируем компонент
import { MainView } from './views/main/main';
import { FavoritesView } from './views/favorites/favorites';

// Основной класс приложения
class App {
  // Массив маршрутов
  routes = [
    { path: '', view: MainView },
    { path: '#favorites', view: FavoritesView },
  ];

  // Глобальный State для работы с Favorites
  appState = {
    favorites: [],
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
    const view = this.routes.find((r) => r.path === location.hash).view;

    // Создаём экземпляр класса для отрисовки страницы
    this.currentView = new view(this.appState);

    // Вызываем render, чтобы отрисовать страницу
    this.currentView.render();
  }
}

// Запускаем наше приложение
new App();
