// static/script.js

function switchLanguage(lang, clickedBtn) {
    const allLangBlocks = document.querySelectorAll('.lang-content');
    allLangBlocks.forEach(el => el.style.display = 'none');

    const selectedLangBlocks = document.querySelectorAll('.lang-' + lang);
    selectedLangBlocks.forEach(el => el.style.display = 'block');

    const buttons = document.querySelectorAll('.language-toggle button');
    buttons.forEach(btn => btn.classList.remove('selected'));
    clickedBtn.classList.add('selected');
}
