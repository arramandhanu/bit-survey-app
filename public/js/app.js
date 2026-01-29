/**
 * Kiosk Survey Application - Frontend JavaScript
 * With Slideshow Welcome Screen
 */

(function () {
    'use strict';

    // Configuration
    const TOTAL_QUESTIONS = 5;
    const COUNTDOWN_SECONDS = 5;
    const SLIDESHOW_INTERVAL = 5000; // 5 seconds per slide
    const API_BASE = window.location.origin;

    // State
    let currentStep = 'welcome';
    let answers = {};
    let countdownTimer = null;
    let slideshowTimer = null;
    let currentSlide = 1;
    let isTransitioning = false;

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
    function init() {
        // Get DOM elements
        progressFill = document.getElementById('progressFill');
        progressText = document.getElementById('progressText');
        progressBar = document.getElementById('progressBar');
        countdownEl = document.getElementById('countdown');
        surveyHeader = document.getElementById('surveyHeader');
        surveyFooter = document.getElementById('surveyFooter');
        touchOverlay = document.getElementById('touchToStart');

        bindEvents();
        startSlideshow();
        preloadImages();
        console.log('Kiosk Survey with Slideshow initialized');
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
    function startSurvey() {
        if (isTransitioning) return;

        console.log('Starting survey...');
        stopSlideshow();
        answers = {};

        // Show header, footer, progress bar, progress text
        if (surveyHeader) surveyHeader.classList.remove('hidden');
        if (surveyFooter) surveyFooter.classList.remove('hidden');
        if (progressBar) progressBar.classList.remove('hidden');
        if (progressText) progressText.classList.remove('hidden');

        goToStep(1);
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

        if (step === 'welcome' || step === 'complete') {
            progressFill.style.width = step === 'complete' ? '100%' : '0%';
            // Hide progress bar and text on welcome/complete
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

        // Trigger confetti celebration
        createConfetti();

        try {
            const response = await fetch(`${API_BASE}/api/survey`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    questions: answers,
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

        // Start countdown to restart
        startCountdown();
    }

    /**
     * Create confetti celebration effect
     */
    function createConfetti() {
        const container = document.getElementById('confettiContainer');
        if (!container) return;

        container.innerHTML = ''; // Clear previous confetti

        const colors = ['#28A745', '#F39C12', '#DC3545', '#0F2E5C', '#17a2b8', '#6f42c1'];
        const shapes = ['circle', 'square', 'triangle'];
        const confettiCount = 100;

        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.className = `confetti ${shapes[Math.floor(Math.random() * shapes.length)]}`;

            const color = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.backgroundColor = color;
            confetti.style.color = color;
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.animationDelay = Math.random() * 2 + 's';
            confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';

            container.appendChild(confetti);
        }

        // Clear confetti after animation
        setTimeout(() => {
            container.innerHTML = '';
        }, 5000);
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
})();
