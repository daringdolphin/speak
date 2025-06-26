import React, { useMemo } from 'react'

interface MeterProps {
  level: number      // Current RMS level (0-1)
  avgLevel: number   // Average level over time (0-1)
}

export const Meter: React.FC<MeterProps> = ({ level, avgLevel }) => {
  // Convert RMS level to visual bars (0-5 bars)
  const activeBars = useMemo(() => {
    // Use the higher of current level or average for better visual feedback
    const displayLevel = Math.max(level, avgLevel * 0.7)
    return Math.min(Math.floor(displayLevel * 5), 5)
  }, [level, avgLevel])

  // Generate bar heights with some randomization for more dynamic look
  const barHeights = useMemo(() => {
    const heights = []
    for (let i = 0; i < 5; i++) {
      if (i < activeBars) {
        // Active bars: vary height based on level with some randomization
        const baseHeight = 20 + (level * 30) + (Math.random() * 10)
        heights.push(Math.min(baseHeight, 50))
      } else {
        // Inactive bars: minimal height
        heights.push(4)
      }
    }
    return heights
  }, [activeBars, level])

  return (
    <div className="level-meter">
      <div className="meter-bars">
        {barHeights.map((height, index) => (
          <div
            key={index}
            className={`meter-bar ${index < activeBars ? 'active' : ''}`}
            style={{
              height: `${height}px`,
              animationDelay: `${index * 50}ms`
            }}
          />
        ))}
      </div>
      
      <style dangerouslySetInnerHTML={{
        __html: `
        .level-meter {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .meter-bars {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 60px;
          padding: 4px;
        }

        .meter-bar {
          width: 6px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
          transition: all 0.1s ease;
        }

        .meter-bar.active {
          background: linear-gradient(
            to top,
            #10B981 0%,
            #34D399 50%,
            #6EE7B7 100%
          );
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
          animation: pulse-bar 0.15s ease-in-out;
        }

        @keyframes pulse-bar {
          0% {
            transform: scaleY(0.8);
          }
          50% {
            transform: scaleY(1.1);
          }
          100% {
            transform: scaleY(1);
          }
        }

        .meter-bar:nth-child(4).active {
          background: linear-gradient(
            to top,
            #F59E0B 0%,
            #FBBF24 50%,
            #FDE047 100%
          );
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
        }

        .meter-bar:nth-child(5).active {
          background: linear-gradient(
            to top,
            #EF4444 0%,
            #F87171 50%,
            #FCA5A5 100%
          );
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
        }
        `
      }} />
    </div>
  )
} 