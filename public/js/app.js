/**
 * Kiosk Survey Application - Frontend JavaScript
 * With Slideshow Welcome Screen
 */

(function () {
    'use strict';

    // Configuration
    let TOTAL_QUESTIONS = 5;
    const COUNTDOWN_SECONDS = 5;
    const SLIDESHOW_INTERVAL = 5000; // 5 seconds per slide
    const API_BASE = window.location.origin;

    // State
    let currentStep = 'welcome';
    let answers = {};
    let queueId = ''; // Store Queue ID
    let countdownTimer = null;
    let slideshowTimer = null;
    let currentSlide = 1;
    let isTransitioning = false;
    let questionsData = [];

    // Emoji URLs for different question types
    const emojiMap = {
        positive: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Star-Struck.png',
        neutral: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Slightly%20Smiling%20Face.png',
        negative: 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Smilies/Worried%20Face.png'
    };

    // DOM Elements
    let progressFill;
    let progressText;
    let progressBar;
    let countdownEl;
    let surveyHeader;
    let surveyFooter;
    let touchOverlay;

    /**
     * Initialize the application
     */
    async function init() {
        // Get DOM elements
        progressFill = document.getElementById('progressFill');
        progressText = document.getElementById('progressText');
        progressBar = document.getElementById('progressBar');
        countdownEl = document.getElementById('countdown');
        surveyHeader = document.getElementById('surveyHeader');
        surveyFooter = document.getElementById('surveyFooter');
        touchOverlay = document.getElementById('touchToStart');

        // Load questions from API
        await loadQuestions();

        bindEvents();

        startSlideshow();
        startClock(); // Start queue clock
        preloadImages();
        console.log('Kiosk Survey with Slideshow initialized');
    }

    /**
     * Start the clock for queue page
     */
    function startClock() {
        const timeEl = document.getElementById('queueDateTime');
        if (!timeEl) return;

        function update() {
            const now = new Date();
            const options = {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            timeEl.textContent = now.toLocaleDateString('id-ID', options);
        }

        update();
        setInterval(update, 10000); // Update every 10s is enough
    }

    /**
     * Load questions from API
     */
    async function loadQuestions() {
        try {
            const response = await fetch(`${API_BASE}/api/questions`);
            const result = await response.json();

            if (result.success && result.questions.length > 0) {
                questionsData = result.questions;
                TOTAL_QUESTIONS = questionsData.length;
                renderQuestions();
            } else {
                console.error('No questions found');
            }
        } catch (error) {
            console.error('Error loading questions:', error);
        }
    }

    /**
     * Render questions dynamically
     */
    function renderQuestions() {
        const container = document.getElementById('questionsContainer');
        if (!container) return;

        container.innerHTML = questionsData.map((q, index) => `
            <section class="survey-step" id="step-${index + 1}">
                ${index === 0 ? `
                <button class="btn-back-home" type="button">
                    <i class="fas fa-arrow-left"></i>
                    <span>Kembali</span>
                </button>
                ` : ''}
                <div class="step-content">
                    <h2 class="question-title">${q.question_text}</h2>
                    <p class="question-subtitle">${q.question_subtitle}</p>

                    <div class="rating-grid">
                        <button class="rating-option" data-question="${q.question_key}" data-value="sangat_baik">
                            <img src="${emojiMap.positive}" alt="${q.option_positive}" class="option-emoji">
                            <span class="option-label green">${q.option_positive}</span>
                        </button>
                        <button class="rating-option" data-question="${q.question_key}" data-value="cukup_baik">
                            <img src="${emojiMap.neutral}" alt="${q.option_neutral}" class="option-emoji">
                            <span class="option-label orange">${q.option_neutral}</span>
                        </button>
                        <button class="rating-option" data-question="${q.question_key}" data-value="kurang_baik">
                            <img src="${emojiMap.negative}" alt="${q.option_negative}" class="option-emoji">
                            <span class="option-label red">${q.option_negative}</span>
                        </button>
                    </div>
                </div>
            </section>
        `).join('');

        // Attach event listener for back button
        const backBtn = container.querySelector('.btn-back-home');
        if (backBtn) {
            addTapEvent(backBtn, function(e) {
                // Prevent bubbling
                e.stopPropagation();
                // Reset to home
                resetSurvey();
            });
        }
    }

    /**
     * Preload images for smoother transitions
     */
    function preloadImages() {
        const images = document.querySelectorAll('.option-emoji, .large-emoji, .slide-background');
        images.forEach(img => {
            if (img.tagName === 'IMG') {
                const preload = new Image();
                preload.src = img.src;
            }
        });
    }

    /**
     * Add touch/click event to element
     */
    function addTapEvent(element, handler) {
        if (!element) return;

        let touchHandled = false;

        element.addEventListener('touchstart', function (e) {
            touchHandled = true;
        }, { passive: true });

        element.addEventListener('touchend', function (e) {
            if (touchHandled) {
                e.preventDefault();
                handler.call(this, e);
                touchHandled = false;
            }
        }, { passive: false });

        element.addEventListener('click', function (e) {
            if (!touchHandled) {
                handler.call(this, e);
            }
            touchHandled = false;
        });
    }

    /**
     * Bind event listeners
     */
    function bindEvents() {
        // Touch overlay to start survey
        addTapEvent(touchOverlay, startSurvey);

        // Also allow clicking anywhere on slideshow
        const slideshowContainer = document.getElementById('slideshow');
        if (slideshowContainer) {
            addTapEvent(slideshowContainer, function (e) {
                // Only start if clicking the overlay or container directly
                if (e.target === touchOverlay ||
                    e.target.closest('.touch-overlay') ||
                    e.target.closest('.slide')) {
                    startSurvey();
                }
            });
        }

        // Rating options
        const ratingOptions = document.querySelectorAll('.rating-option');
        ratingOptions.forEach(option => {
            addTapEvent(option, handleRatingClick);
        });

        // Slide indicators
        const indicators = document.querySelectorAll('.indicator');
        indicators.forEach(indicator => {
            addTapEvent(indicator, function () {
                const slideNum = parseInt(this.dataset.slide);
                goToSlide(slideNum);
            });
        });

        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (e) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });

        // Prevent pinch zoom
        document.addEventListener('gesturestart', function (e) {
            e.preventDefault();
        });

        // Queue Keypad Events
        const keys = document.querySelectorAll('.virtual-keypad .key');
        keys.forEach(key => {
            addTapEvent(key, handleKeypadInput);
        });
    }

    /* =====================================================
       SLIDESHOW FUNCTIONS
       ===================================================== */

    /**
     * Start the slideshow auto-rotation
     */
    function startSlideshow() {
        slideshowTimer = setInterval(() => {
            nextSlide();
        }, SLIDESHOW_INTERVAL);
    }

    /**
     * Stop the slideshow
     */
    function stopSlideshow() {
        if (slideshowTimer) {
            clearInterval(slideshowTimer);
            slideshowTimer = null;
        }
    }

    /**
     * Go to next slide
     */
    function nextSlide() {
        const totalSlides = 3;
        const nextSlideNum = currentSlide >= totalSlides ? 1 : currentSlide + 1;
        goToSlide(nextSlideNum);
    }

    /**
     * Go to specific slide
     */
    function goToSlide(slideNum) {
        // Update slide visibility
        const slides = document.querySelectorAll('.slide');
        slides.forEach((slide, index) => {
            slide.classList.toggle('active', index + 1 === slideNum);
        });

        // Update indicators
        const indicators = document.querySelectorAll('.indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index + 1 === slideNum);
        });

        currentSlide = slideNum;
    }

    /* =====================================================
       SURVEY FUNCTIONS
       ===================================================== */

    /**
     * Start the survey
     */
    async function startSurvey() {
        if (isTransitioning) return;

        console.log('Starting survey...');
        stopSlideshow();
        answers = {};

        // Start session - server sets HttpOnly cookie automatically
        try {
            const response = await fetch(`${API_BASE}/api/session`, {
                credentials: 'include'  // Include cookies in request
            });
            const data = await response.json();
            if (data.success) {
                console.log('Session started (cookie set by server)');
            }
        } catch (error) {
            console.error('Failed to start session:', error);
        }

        // Show header, footer, progress bar, progress text
        if (surveyHeader) surveyHeader.classList.remove('hidden');
        if (surveyFooter) surveyFooter.classList.remove('hidden');
        if (progressBar) progressBar.classList.remove('hidden');
        if (surveyHeader) surveyHeader.classList.remove('hidden');
        if (surveyFooter) surveyFooter.classList.remove('hidden');

        // Go to Queue Input first
        goToStep('queue');
    }

    /**
     * Navigate to a specific step
     */
    function goToStep(stepNumber) {
        if (isTransitioning && stepNumber !== 'welcome') return;
        isTransitioning = true;

        const previousStep = currentStep;
        currentStep = stepNumber;

        // Update progress
        updateProgress(stepNumber);

        // Get step elements
        const prevStepEl = document.getElementById(`step-${previousStep}`);
        const nextStepEl = document.getElementById(`step-${stepNumber}`);

        console.log(`Navigating from step-${previousStep} to step-${stepNumber}`);

        // Animate step transition
        if (prevStepEl) {
            prevStepEl.classList.remove('active');
            prevStepEl.classList.add('exit');

            setTimeout(() => {
                prevStepEl.classList.remove('exit');
            }, 500);
        }

        if (nextStepEl) {
            setTimeout(() => {
                nextStepEl.classList.add('active');
                isTransitioning = false;
            }, 150);
        } else {
            isTransitioning = false;
        }
    }

    /**
     * Update progress bar and text
     */
    function updateProgress(step) {
        if (!progressFill || !progressText) return;

        if (step === 'welcome' || step === 'complete' || step === 'queue') {
            progressFill.style.width = step === 'complete' ? '100%' : '0%';
            // Hide progress bar and text on welcome/complete/queue
            if (progressBar) progressBar.classList.add('hidden');
            if (progressText) progressText.classList.add('hidden');
        } else {
            const progress = (step / TOTAL_QUESTIONS) * 100;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `Pertanyaan ${step} dari ${TOTAL_QUESTIONS}`;
            // Show progress bar and text during survey
            if (progressBar) progressBar.classList.remove('hidden');
            if (progressText) progressText.classList.remove('hidden');
        }
    }

    /**
     * Handle rating option click
     */
    function handleRatingClick(e) {
        if (isTransitioning) return;

        const option = e.currentTarget || e.target.closest('.rating-option');
        if (!option) return;

        const question = option.dataset.question;
        const value = option.dataset.value;

        console.log(`Rating clicked: ${question} = ${value}`);

        if (!question || !value) return;

        // Visual feedback
        const siblings = option.parentElement.querySelectorAll('.rating-option');
        siblings.forEach(sib => sib.classList.remove('selected'));
        option.classList.add('selected');

        // Store answer
        answers[question] = value;

        // Wait for animation then go to next step
        setTimeout(() => {
            const currentQuestionNum = parseInt(question.replace('q', ''));

            if (currentQuestionNum < TOTAL_QUESTIONS) {
                goToStep(currentQuestionNum + 1);
            } else {
                submitSurvey();
            }
        }, 300);
    }

    /**
     * Submit survey to server
     */
    async function submitSurvey() {
        goToStep('complete');

        try {
            const response = await fetch(`${API_BASE}/api/survey`, {
                method: 'POST',
                credentials: 'include',  // Include cookies (HttpOnly session)
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    questions: answers,
                    queueId: queueId, // Send Queue ID
                    timestamp: new Date().toISOString()
                }),
            });

            const result = await response.json();

            if (result.success) {
                console.log('Survey submitted successfully');
            } else {
                console.error('Survey submission failed:', result.error);
            }
        } catch (error) {
            console.error('Error submitting survey:', error);
        }

        // Reset queueId
        queueId = '';

        // Start countdown to restart
        startCountdown();
    }

    /**
     * Start countdown timer
     */
    function startCountdown() {
        let seconds = COUNTDOWN_SECONDS;
        if (countdownEl) {
            countdownEl.textContent = seconds;
        }

        countdownTimer = setInterval(() => {
            seconds--;
            if (countdownEl) {
                countdownEl.textContent = seconds;
            }

            if (seconds <= 0) {
                clearInterval(countdownTimer);
                resetSurvey();
            }
        }, 1000);
    }

    /**
     * Reset survey to initial state
     */
    function resetSurvey() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
        }

        // Reset answers
        answers = {};
        queueId = '';
        updateQueueDisplay();
        isTransitioning = false;

        // Reset all selected states
        document.querySelectorAll('.rating-option.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Hide header, footer, progress bar
        if (surveyHeader) surveyHeader.classList.add('hidden');
        if (surveyFooter) surveyFooter.classList.add('hidden');
        if (progressBar) progressBar.classList.add('hidden');

        // Go back to welcome
        currentSlide = 1;
        goToSlide(1);
        goToStep('welcome');

        // Restart slideshow
        startSlideshow();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /**
     * Handle Keypad Input
     */
    function handleKeypadInput(e) {
        const btn = e.currentTarget;
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const display = document.getElementById('queueInput');
        const submitBtn = document.getElementById('submitQueueBtn');

        if (action === 'submit') {
            if (!queueId) return;
            // Go to first question
            if (progressBar) progressBar.classList.remove('hidden');
            if (progressText) progressText.classList.remove('hidden');
            goToStep(1);
            return;
        }

        if (action === 'clear') {
            queueId = '';
        } else if (action === 'backspace') {
            queueId = queueId.slice(0, -1);
        } else if (key) {
            // Limit length
            if (queueId.length < 5) {
                // Auto-append hyphen if it's a letter and first character
                const isLetter = /^[A-E]$/.test(key);
                if (queueId.length === 0 && isLetter) {
                    queueId += key + '-';
                } else {
                    queueId += key;
                }
            }
        }

        updateQueueDisplay();

        // Add button animation class
        btn.classList.add('clicked');
        setTimeout(() => btn.classList.remove('clicked'), 200);
    }

    function updateQueueDisplay() {
        const display = document.getElementById('queueInput');
        const submitBtn = document.getElementById('submitQueueBtn');

        if (display) {
            display.textContent = queueId;
        }

        if (submitBtn) {
            if (queueId.length > 0) {
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
            } else {
                submitBtn.disabled = true;
                submitBtn.classList.remove('active');
            }
        }
    }
})();
