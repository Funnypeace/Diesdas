
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Chicken as ChickenType } from './types';
import { GAME_DURATION_SECONDS, CHICKEN_SPAWN_INTERVAL_MS, CHICKEN_SCORE_MAP } from './constants';
import Chicken from './components/Chicken';
import GameUI from './components/GameUI';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.IDLE);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [chickens, setChickens] = useState<ChickenType[]>([]);
  const [clickEffects, setClickEffects] = useState<{ id: number; x: number; y: number }[]>([]);

  const gameLoopRef = useRef<number>();
  const spawnTimerRef = useRef<number>();
  const countdownTimerRef = useRef<number>();
  const nextChickenId = useRef(0);
  const nextClickEffectId = useRef(0);

  const clearTimers = useCallback(() => {
    if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const spawnChicken = useCallback(() => {
    const direction = Math.random() < 0.5 ? 'left' : 'right';
    const y = Math.random() * (window.innerHeight * 0.6) + window.innerHeight * 0.1; // Spawn in vertical middle 60%
    const x = direction === 'right' ? -100 : window.innerWidth + 100;
    
    const randomType = Math.random();
    let type: 'slow' | 'normal' | 'fast';
    let speed: number;

    if (randomType < 0.2) {
      type = 'fast';
      speed = Math.random() * 2 + 4; // 4-6 pixels/frame
    } else if (randomType < 0.7) {
      type = 'normal';
      speed = Math.random() * 1.5 + 2; // 2-3.5 pixels/frame
    } else {
      type = 'slow';
      speed = Math.random() * 1 + 1; // 1-2 pixels/frame
    }

    const newChicken: ChickenType = {
      id: nextChickenId.current++,
      x,
      y,
      speed,
      direction,
      isHit: false,
      type: type,
    };
    setChickens(prev => [...prev, newChicken]);
  }, []);

  const startGame = useCallback(() => {
    clearTimers();
    setGameState(GameState.RUNNING);
    setScore(0);
    setTimeLeft(GAME_DURATION_SECONDS);
    setChickens([]);
    nextChickenId.current = 0;

    spawnTimerRef.current = window.setInterval(spawnChicken, CHICKEN_SPAWN_INTERVAL_MS);
    
    countdownTimerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setGameState(GameState.ENDED);
          clearTimers();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const gameLoop = () => {
      setChickens(prev =>
        prev
          .map(c => ({
            ...c,
            x: c.direction === 'right' ? c.x + c.speed : c.x - c.speed,
          }))
          .filter(c => c.x > -150 && c.x < window.innerWidth + 150)
      );
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    gameLoopRef.current = requestAnimationFrame(gameLoop);
  }, [spawnChicken, clearTimers]);
  
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleChickenHit = useCallback((id: number) => {
    let hitChicken: ChickenType | undefined;
    setChickens(prev =>
      prev.map(c => {
        if (c.id === id && !c.isHit) {
          hitChicken = c;
          return { ...c, isHit: true };
        }
        return c;
      })
    );

    if (hitChicken) {
      setScore(prev => prev + CHICKEN_SCORE_MAP[hitChicken!.type]);
      // Remove chicken after animation
      setTimeout(() => {
        setChickens(prev => prev.filter(c => c.id !== id));
      }, 1000);
    }
  }, []);

  const handleGameAreaClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (gameState !== GameState.RUNNING) return;
    
    const newEffect = { id: nextClickEffectId.current++, x: e.clientX, y: e.clientY };
    setClickEffects(prev => [...prev, newEffect]);
    setTimeout(() => {
        setClickEffects(prev => prev.filter(effect => effect.id !== newEffect.id));
    }, 300);
  };


  return (
    <div 
      className="relative w-screen h-screen overflow-hidden bg-gradient-to-b from-sky-400 to-sky-600 cursor-crosshair"
      onClick={handleGameAreaClick}
    >
      <div className="absolute bottom-0 left-0 w-full h-1/5 bg-gradient-to-t from-green-700 to-green-500 z-0" />
      
      {chickens.map(chicken => (
        <Chicken key={chicken.id} data={chicken} onHit={handleChickenHit} />
      ))}
      
      {clickEffects.map(effect => (
        <div 
          key={effect.id}
          className="absolute text-5xl text-yellow-400 font-black pointer-events-none animate-ping"
          style={{ left: `${effect.x}px`, top: `${effect.y}px`, transform: 'translate(-50%, -50%)' }}
        >
          *
        </div>
      ))}
      
      <GameUI 
        gameState={gameState}
        score={score}
        timeLeft={timeLeft}
        onStart={startGame}
        onRestart={startGame}
      />
    </div>
  );
};

export default App;
