// static/script.js

function filterProjects(category, clickedBtn) {
    const cards = document.querySelectorAll('.project-card');
    const buttons = document.querySelectorAll('.filter-buttons button');

    buttons.forEach(btn => btn.classList.remove('selected'));
    clickedBtn.classList.add('selected');

    cards.forEach(card => {
        const cardCategory = card.getAttribute('data-category');
        if (category === 'all' || cardCategory === category) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

function switchLanguage(lang, clickedBtn) {
    const allLangBlocks = document.querySelectorAll('.lang-content');
    allLangBlocks.forEach(el => el.style.display = 'none');

    const selectedLangBlocks = document.querySelectorAll('.lang-' + lang);
    selectedLangBlocks.forEach(el => el.style.display = 'block');

    const buttons = document.querySelectorAll('.language-toggle button');
    buttons.forEach(btn => btn.classList.remove('selected'));
    clickedBtn.classList.add('selected');
}
