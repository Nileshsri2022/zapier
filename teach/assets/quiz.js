// Tiny quiz widget — no dependencies
// Usage: each .quiz container has .q + .choices with button.choice[data-correct="true/false"][data-explain="…"]
// The script wires up click handlers and reveals .feedback

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quiz').forEach(quiz => {
    const feedback = quiz.querySelector('.feedback');
    let answered = false;
    quiz.querySelectorAll('button.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const correct = btn.dataset.correct === 'true';
        // Mark all choices
        quiz.querySelectorAll('button.choice').forEach(b => {
          if (b.dataset.correct === 'true') b.classList.add('correct');
          else if (b === btn && !correct) b.classList.add('wrong');
          b.disabled = true;
          b.style.cursor = 'default';
        });
        if (feedback) {
          feedback.textContent = btn.dataset.explain || (correct ? 'Correct.' : 'Not quite — see explanation above.');
          feedback.className = 'feedback show ' + (correct ? 'ok' : 'no');
        }
      });
    });
    // Reset link if present
    const reset = quiz.querySelector('[data-reset]');
    if (reset) {
      reset.addEventListener('click', (e) => {
        e.preventDefault();
        answered = false;
        quiz.querySelectorAll('button.choice').forEach(b => {
          b.classList.remove('correct','wrong');
          b.disabled = false;
          b.style.cursor = 'pointer';
        });
        if (feedback) { feedback.className = 'feedback'; feedback.textContent = ''; }
      });
    }
  });
});
