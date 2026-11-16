# Dark twins of the notebook-style project cards

The home page shows `static/media/<project>/card.png` in light mode and `card-dark.png` in dark mode
(`class="light-img"` / `class="dark-img"`, switched in `static/style.css`). How each dark card is made:

| Card | How |
|---|---|
| Loaf Tower | `python tools/assets.py card-dark` in `C:\mobile-game` (drawn by the game itself, dark theme) |
| Remote Desktop | `C:\remote-desktop\tools\card\card-dark.html` rendered with `render_card.py` there |
| This Website | `site_card.py` here: a screenshot of the real home page hero in dark mode |
| Karaoke | `python tools/card-dark/recolor.py static/media/karaoke/card.png static/media/karaoke/card-dark.png 134,300,651,497` (the box keeps the TV screen as is) |
| Chacrinha Jiu-Jitsu | `python tools/card-dark/recolor.py static/media/jiujitsu/card.png static/media/jiujitsu/card-dark.png` |

`recolor.py` flips neutral paper/ink tones to the dark palette (paper `#0d1117`, ink `#f0f6fc`) and keeps
colourful parts. A new notebook card needs a dark twin too, or it shows the light one in dark mode.
