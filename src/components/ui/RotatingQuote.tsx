/**
 * RotatingQuote Component
 * 
 * Location: src/components/ui/RotatingQuote.tsx
 * 
 * A production-ready rotating quote display system designed for
 * enterprise ERP applications. Features:
 * - External data source (JSON/API ready)
 * - Fisher-Yates shuffle for non-repeating rotation
 * - Soft fade transitions
 * - Fixed height to prevent layout shift
 * - Proper cleanup on unmount
 * - Minimal re-renders
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// Type definitions for quote structure
interface Quote {
    id: number;
    text: string;
    category?: string;
}

interface QuotesData {
    version?: string;
    lastUpdated?: string;
    quotes: Quote[];
}

interface RotatingQuoteProps {
    /** URL to fetch quotes from. Defaults to /data/quotes.json */
    dataSource?: string;
    /** Rotation interval in milliseconds. Defaults to 30000 (30 seconds) */
    intervalMs?: number;
    /** Fixed height for the quote container. Defaults to '60px' */
    height?: string;
    /** Custom className for additional styling */
    className?: string;
}

/**
 * Fisher-Yates shuffle algorithm for unbiased randomization
 * Creates a new shuffled array without mutating the original
 */
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function RotatingQuote({
    dataSource = '/data/quotes.json',
    intervalMs = 30000,
    height = '60px',
    className = '',
}: RotatingQuoteProps) {
    // State for quotes pool and current index
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isVisible, setIsVisible] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Refs for stable interval management
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const shuffledQuotesRef = useRef<Quote[]>([]);

    // Fetch quotes from external source
    useEffect(() => {
        let isMounted = true;

        const fetchQuotes = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const response = await fetch(dataSource);
                if (!response.ok) {
                    throw new Error(`Failed to fetch quotes: ${response.status}`);
                }

                const data: QuotesData = await response.json();

                if (!data.quotes || !Array.isArray(data.quotes) || data.quotes.length === 0) {
                    throw new Error('No quotes found in data source');
                }

                if (isMounted) {
                    // Shuffle quotes for non-repeating rotation
                    const shuffled = shuffleArray(data.quotes);
                    shuffledQuotesRef.current = shuffled;
                    setQuotes(shuffled);
                    setCurrentIndex(0);
                    setIsLoading(false);
                }
            } catch (err) {
                console.error('RotatingQuote: Error fetching quotes:', err);
                if (isMounted) {
                    setError(err instanceof Error ? err.message : 'Failed to load quotes');
                    setIsLoading(false);
                }
            }
        };

        fetchQuotes();

        return () => {
            isMounted = false;
        };
    }, [dataSource]);

    // Rotation logic with fade transition
    const rotateQuote = useCallback(() => {
        // Start fade out
        setIsVisible(false);

        // After fade out, change quote and fade in
        setTimeout(() => {
            setCurrentIndex((prevIndex) => {
                const nextIndex = prevIndex + 1;
                // If we've exhausted the pool, reshuffle
                if (nextIndex >= shuffledQuotesRef.current.length) {
                    shuffledQuotesRef.current = shuffleArray(shuffledQuotesRef.current);
                    return 0;
                }
                return nextIndex;
            });
            setIsVisible(true);
        }, 300); // Match CSS transition duration
    }, []);

    // Set up rotation interval
    useEffect(() => {
        if (quotes.length === 0) return;

        // Clear any existing interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        // Set up new interval
        intervalRef.current = setInterval(rotateQuote, intervalMs);

        // Cleanup on unmount or dependency change
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [quotes.length, intervalMs, rotateQuote]);

    // Current quote to display
    const currentQuote = quotes[currentIndex];

    // Container styles - fixed height prevents layout shift
    const containerStyle: React.CSSProperties = {
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    };

    // Quote text styles - subtle, secondary appearance
    const quoteStyle: React.CSSProperties = {
        fontSize: '13px',
        fontWeight: 400,
        color: '#94a3b8', // Muted slate color
        textAlign: 'center',
        lineHeight: 1.5,
        padding: '0 16px',
        fontStyle: 'italic',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 300ms ease-in-out',
        maxWidth: '100%',
    };

    // Loading state
    if (isLoading) {
        return (
            <div style={containerStyle} className={className}>
                <span style={{ ...quoteStyle, opacity: 0.5 }}>
                    Loading...
                </span>
            </div>
        );
    }

    // Error state - fail silently with subtle message
    if (error || !currentQuote) {
        return (
            <div style={containerStyle} className={className}>
                <span style={{ ...quoteStyle, opacity: 0.5 }}>
                    Empowering your operations
                </span>
            </div>
        );
    }

    return (
        <div style={containerStyle} className={className}>
            <span style={quoteStyle}>
                "{currentQuote.text}"
            </span>
        </div>
    );
}

export default RotatingQuote;
