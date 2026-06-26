# cards.pdf reading notes

Source: `Doc/cards.pdf`

## What was extracted

- PDF pages: 110
- Embedded images: 974
- Unique embedded image objects: 201
- Full image manifest: `tmp/pdfs/cards-read/manifest.csv`
- Unique image manifest: `tmp/pdfs/cards-read/unique-manifest.csv`
- Contact sheets: `tmp/pdfs/cards-read/sheets/`
- Unique contact sheets: `tmp/pdfs/cards-read/unique-sheets/`

The PDF text layer only contains page headings. Card text is rasterized inside images, so direct `pdftotext` extraction is not enough.

## Print Structure

The PDF is a print stream, not a clean card database. Cards are placed left-to-right, top-to-bottom, and repeated for printing.

Important: visual rows can contain `back-front-back`, with the matching front continuing on the next row or page. A deck editor should therefore store a logical card stream and generate print sheets from it, not treat each printed page as source data.

## Readable Card Groups

### Base / starting cards

- Воин
- Базовый чертеж на дубину
- Дубина
- Бусы телепортации
- Шаман
- Клубок сплетенной нити из шерсти барана
- Ковер шамана
- Базовый рецепт на ковер шамана
- Очищенная шкура барана
- Шерсть барана
- Шкура барана
- Баран
- Помощник кузнеца
- Рецепт на мешок
- Мешок
- Охотник
- Кузнец
- Базовый чертеж на палаток / молоток
- Палаток / молоток
- Грязная смешанная железная руда

### Mixed ground / shared resource cards

- Рубашка: Смешанный грунт
- Железная руда среднего качества
- Грязная / смешанная железная руда
- Сухой череп или череп
- Очищенная шкура зверя
- Шкура убитого зверя
- Дикий кабан
- Малый золотой самородок

### Forest trail / forest cards

- Рубашка: Лесная тропа
- Гриб мухомор
- Кора дерева
- Дубовые желуди
- Полянка мухоморов
- Полена дерева
- Дикие красные ягоды
- Гнущаяся палка
- Ночной филин
- Обычная сова
- Черные ягоды
- Железная руда высшего качества
- Толстая ветка

### Lake / gem cards

- Рубашка: Озеро
- Мраморный самоцвет
- Мутный изумруд
- Драгоценный камень
- Крапленый аметист
- Необработанный рубин
- Озерная лягушка
- Проросший корень

### Beasts and hides

- Бурый медведь
- Агрессивный бурый медведь
- Серый волк
- Дикий кабан
- Шкура медведя
- Шкура убитого зверя
- Очищенная шкура зверя

### Dark forest and equipment

- Рубашка: Темный лес
- Средний золотой самородок
- Большой золотой самородок
- Чертеж на небрежную кольчугу
- Небрежная кольчуга
- Чертеж на легкую кольчугу
- Легкая кольчуга
- Чертеж на щит защита духа
- Щит защита духа
- Чертеж на щит др.
- Щит др.
- Чертеж на ломщит
- Ломщит
- Чертеж на топормол
- Топормол
- Чертеж на щит калан
- Щит калан
- Чертеж на меч сеч
- Меч сеч
- Чертеж на деревянный молоток
- Деревянный молоток
- Чертеж на красное солнце
- Секира красное солнце
- Задание на молот Иерихон
- Иерихон
- Чертеж на меч лорп
- Меч Лорп
- Кольцо возврата
- Чертеж на ошейник
- Ошейник приручения
- Чертеж на щит отмщение
- Щит отмщение
- Чертеж на щит луна
- Щит луна
- Чертеж шема
- Шлем шем
- Чертеж на рецепт близнецы
- Топоры близнецы
- Чертеж на панцирь
- Панцирь
- Чертеж на шлем ТТМ
- Шлем ТТМ
- Чертеж на защиту Ил
- Защита Ил

### Recipes deck

- Рубашка колоды: Рецепты
- Рецепт на жест
- Жест
- Рецепт на каска-маска
- Каска-маска
- Рецепт на рубашку из кожи
- Кожаная рубашка
- Рецепт на одежду разведчика
- Разведка
- Рецепт на маску трехликого
- Маска трехликого
- Рецепт на бубун
- Маска бубун
- Рецепт на маску оху
- Маска оху
- Рецепт на бутыль дип
- Бутыль дип
- Рецепт на маску злая
- Маска злая
- Рецепт на обычный посох
- Обычный посох
- Посох тэрниа
- Порча
- Рецепт на обряд
- Обряд трех
- Рецепт на заклятие хозяин
- Заклятие хозяин

### Fairy glade / special

- Рубашка: Таинственная опушка
- Редкий самоцвет
- Феникс
- Золотое перо к кузнецу противника
- Золотое перо к своему кузнецу
- Жаба вирид

### Junk / non-game image

- Ветка куста. Не применима не к чему
- Flat green placeholder image

## Notes For The Editor

- Use `unique-manifest.csv` for a visual source audit.
- Treat `cards.pdf` as the canonical source for restoration.
- Current code catalog is not authoritative for this step. It already diverges from this PDF and should be updated later from the restored catalog.
- The editor needs explicit fields: `frontArt`, `backArt`, `copies`, `printable`, `legacy`, `inGame`, `sourcePdfObject`, and `notes`.
