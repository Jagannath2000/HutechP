import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Chart from "chart.js/auto";
import zoomPlugin from "chartjs-plugin-zoom";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import {
  SendHorizonal,
  Download,
  Paperclip,
  ImageIcon,
  Trash2,
  Globe,
  MapPin,
  MoreVertical,
  Share2,
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import leafletImage from "leaflet-image";
import ChartDataLabels from "chartjs-plugin-datalabels";

Chart.register(zoomPlugin, ChartDataLabels);

// Debounce hook delays updating value until stable for delay ms
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const ELEVENLABS_API_KEY = "sk_f93511d1abe277fc25ba8ce310fde9be0115c8cac6e06c7c";
const ELEVENLABS_VOICE_ID = "wAGzRVkxKEs8La0lmdrE";

// Audio context for voice activity detection
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let microphone: MediaStreamAudioSourceNode | null = null;
let dataArray: Uint8Array | null = null;
let currentAudio: HTMLAudioElement | null = null;

// Helper to speak text using ElevenLabs API with voice isolation and interruption support
const playElevenLabsTTS = async (text: string) => {
  try {
    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      }
    );
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    
    // Start playing audio
    await audio.play();
    
    return new Promise((resolve) => {
      audio.onended = () => {
        currentAudio = null;
        // Small delay after TTS ends before re-enabling speech recognition
        setTimeout(() => {
          resolve(undefined);
        }, 300);
      };
      
      // Handle interruption
      audio.onpause = () => {
        currentAudio = null;
        resolve(undefined);
      };
    });
  } catch (err) {
    console.error("ElevenLabs TTS error:", err);
    currentAudio = null;
    throw err;
  }
};

// Initialize audio context for voice activity detection
const initializeAudioContext = async () => {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
    }
  } catch (error) {
    console.error("Error initializing audio context:", error);
  }
};

// Voice activity detection
const detectVoiceActivity = (): boolean => {
  if (!analyser || !dataArray) return false;
  
  analyser.getByteFrequencyData(dataArray);
  
  // Calculate average volume
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const average = sum / dataArray.length;
  
  // Voice activity threshold (adjust as needed)
  return average > 20;
};

const showToast = (msg: string) => {
  const toast = document.createElement("div");
  toast.innerText = msg;
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.left = "50%";
  toast.style.transform = "translateX(-50%)";
  toast.style.background = "#2563eb";
  toast.style.color = "#fff";
  toast.style.padding = "12px 24px";
  toast.style.borderRadius = "8px";
  toast.style.fontSize = "1rem";
  toast.style.zIndex = "9999";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1700);
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost";
  className?: string;
};

const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  const variants: Record<string, string> = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    ghost: "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200",
  };
  const finalClassName = `${baseClasses} ${variants[variant]} ${className || ""}`;
  return (
    <button className={finalClassName} {...props}>
      {children}
    </button>
  );
};

const ChartContainer: React.FC<{ children: React.ReactNode; dataLength: number; className?: string; height?: string }> = ({
  children,
  dataLength,
  className = "",
  height = "500px"
}) => {
  const itemWidth = 80;
  const minWidth = dataLength * itemWidth;
  return (
    <div
      className={`overflow-x-auto w-full bg-white dark:bg-gray-700 rounded-lg border p-2 flex flex-col relative ${className}`}
      style={{ height }}
    >
      <div style={{ minWidth, height: "100%" }} className="flex-grow relative">
        {children}
      </div>
    </div>
  );
};

type ChartDataItem =
  | { type: "user" | "text" | "error"; data: string; timestamp: string }
  | { type: string; data: any; timestamp: string };

const ReportDashboard: React.FC = () => {
  const [awaitingMoreQuestion, setAwaitingMoreQuestion] = useState(false);
  const [speechTimeout, setSpeechTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const [chartDataList, setChartDataList] = useState<ChartDataItem[]>(() => {
    const stored = localStorage.getItem("chartDataList");
    return stored ? JSON.parse(stored) : [];
  });

  const [userInput, setUserInput] = useState<string>("");
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition();

  const debouncedSpeech = useDebounce<string>(transcript, 800);

  const [loading, setLoading] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRefs = useRef<Map<number, L.Map>>(new Map());
  const leafletMarkersRefs = useRef<Map<number, L.CircleMarker[]>>(new Map());
  const chartJsInstances = useRef<Map<number, Chart>>(new Map());
  const [currentMapDisplayMode, setCurrentMapDisplayMode] = useState<"india" | "world">("india");
  const token = localStorage.getItem("token") || "mock-token-for-testing";
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);
  const optionsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);

  // Utility to get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    if (hour < 22) return "Good evening";
    return "Good night";
  };

  // Enhanced TTS function with better voice isolation
  const speakWithIsolation = async (text: string) => {
    setIsTTSPlaying(true);
    try {
      await playElevenLabsTTS(text);
    } catch (error) {
      console.error("TTS Error:", error);
    } finally {
      setIsTTSPlaying(false);
    }
  };

  // Handler for voice button - Enhanced with better voice isolation
  const handleVoiceButtonClick = async () => {
    if (!browserSupportsSpeechRecognition) {
      showToast("Browser doesn't support speech recognition");
      return;
    }

    if (listening) {
      SpeechRecognition.stopListening();
      setAwaitingMoreQuestion(false);
      resetTranscript();
      return;
    }

    try {
      await initializeAudioContext();
      resetTranscript();
      
      const greeting = `${getGreeting()}. Hello! I am your AI health assistant. How can I help you today?`;
      await speakWithIsolation(greeting);

      // Start listening after greeting finishes with enhanced settings
      setTimeout(() => {
        if (!isTTSPlaying) {
          SpeechRecognition.startListening({
            continuous: true,
            language: 'en-US',
            interimResults: true
          });
          setAwaitingMoreQuestion(true);
        }
      }, 500);
    } catch (error) {
      console.error("Error with voice setup:", error);
      showToast("Error starting voice assistant");
    }
  };

  // Handle file upload
  const handleUploadFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.xls,.txt,.json";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) showToast(`Uploaded file: ${file.name}`);
    };
    input.click();
    setShowOptionsDropdown(false);
  };

  // Handle photo upload
  const handleUploadPhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) showToast(`Uploaded photo: ${file.name}`);
    };
    input.click();
    setShowOptionsDropdown(false);
  };

  // Share functions
  const handleShareChart = async (index: number) => {
    const chartInstance = chartJsInstances.current.get(index);
    if (chartInstance) {
      const canvas = chartInstance.canvas;
      const dataUrl = canvas.toDataURL("image/png");
      if (navigator.share) {
        await navigator.share({
          title: `Chart ${index + 1}`,
          text: "Check out this chart!",
          files: [await fetch(dataUrl).then(r => r.blob()).then(blob => new File([blob], `chart_${index + 1}.png`, { type: "image/png" }))]
        });
      } else {
        await navigator.clipboard.writeText(dataUrl);
        showToast("Chart image copied to clipboard!");
      }
    }
  };

  const handleShareMap = async (index: number) => {
    const mapInstance = leafletMapRefs.current.get(index);
    if (!mapInstance) {
      showToast("Map not found for sharing.");
      return;
    }
    leafletImage(mapInstance, async function (err, canvas) {
      if (err) {
        showToast("Failed to capture map image.");
        return;
      }
      const imgData = canvas.toDataURL("image/png");
      if (navigator.share) {
        await navigator.share({
          title: `Map ${index + 1}`,
          text: "Check out this map!",
          files: [await fetch(imgData).then(r => r.blob()).then(blob => new File([blob], `map_${index + 1}.png`, { type: "image/png" }))]
        });
      } else {
        await navigator.clipboard.writeText(imgData);
        showToast("Map image copied to clipboard!");
      }
    });
  };

  // Enhanced speech recognition effect with TTS interruption
  useEffect(() => {
    if (listening && debouncedSpeech.trim()) {
      const lower = debouncedSpeech.trim().toLowerCase();

      // Interrupt TTS if user speaks
      if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        setIsTTSPlaying(false);
      }

      // Check for stop commands
      if (awaitingMoreQuestion && ["no", "no more", "no thanks", "that's all", "stop", "bye"].some(cmd => lower.includes(cmd))) {
        speakWithIsolation("Okay, have a great day!");
        SpeechRecognition.stopListening();
        setAwaitingMoreQuestion(false);
        resetTranscript();
        return;
      }

      // Process the speech input when meaningful
      if (debouncedSpeech.trim().length > 2) {
        handleSend(debouncedSpeech.trim());
        resetTranscript();
      }
    }
  }, [debouncedSpeech, listening, awaitingMoreQuestion]);

  // Immediate interruption on any speech input
  useEffect(() => {
    if (listening && transcript && transcript.trim().length > 3) {
      // Interrupt TTS immediately when user starts speaking
      if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        setIsTTSPlaying(false);
      }
    }
  }, [transcript, listening]);

  // Update input with transcript only when not playing TTS
  useEffect(() => {
    if (listening && transcript && !isTTSPlaying) {
      setUserInput(transcript);
    }
  }, [transcript, listening, isTTSPlaying]);

  // Voice level monitoring for better UI feedback
  useEffect(() => {
    let animationFrame: number;
    
    const updateVoiceLevel = () => {
      if (listening && analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setVoiceLevel(Math.min(average / 50, 1)); // Normalize to 0-1
      } else {
        setVoiceLevel(0);
      }
      animationFrame = requestAnimationFrame(updateVoiceLevel);
    };
    
    if (listening) {
      updateVoiceLevel();
    }
    
    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [listening]);

  // Format timestamp for display
  const formatTimestampForDisplay = (timestamp: string, type: string) => {
    const d = new Date(timestamp);
    if (isNaN(d.getTime()))
      return type === "timeOnly" ? "Invalid Time" : "Invalid Date";

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    const formattedTime = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    let formattedDate;
    if (isSameDay(d, today)) formattedDate = "Today";
    else if (isSameDay(d, yesterday)) formattedDate = "Yesterday";
    else
      formattedDate = d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

    if (type === "timeOnly") return formattedTime;
    if (type === "dateOnly") return formattedDate;
    return `${formattedDate}, ${formattedTime}`;
  };

  // Fetch report data from API - Enhanced with better TTS handling
  const fetchReportData = async (question: string, retryCount = 0) => {
    setLoading(true);
    try {
      const response = await fetch("http://localhost:8090/api/chart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userMessage: question }),
      });
      const result = await response.json();
      setLoading(false);
      const replyTimestamp = new Date().toISOString();

      if (
        result &&
        typeof result.data === "string" &&
        result.data.includes("Gemini Error: Failed to execute HTTP request.") &&
        retryCount < 3
      ) {
        setTimeout(() => fetchReportData(question, retryCount + 1), 1000);
        return;
      }

      if (result.type === "ERROR") {
        updateChartList({
          type: "text",
          data: "Please ask question again.",
          timestamp: replyTimestamp,
        });
        try {
          await speakWithIsolation("Please ask question again.");
        } catch (error) {
          console.error("TTS Error:", error);
        }
        return;
      }

      if (result.type === "GENERAL_RESPONSE") {
        let displayData = result.response || result.data || "No response";
        if (typeof displayData === "string") {
          try {
            const parsedContent = JSON.parse(displayData);
            displayData =
              typeof parsedContent === "string"
                ? parsedContent
                : JSON.stringify(parsedContent, null, 2);
          } catch (err) {
            console.error("Failed to parse displayData as JSON", err);
          }
        }
        updateChartList({
          type: "text",
          data: displayData,
          timestamp: replyTimestamp,
        });
        if (displayData && typeof displayData === "string") {
          try {
            await speakWithIsolation(displayData);
            // Auto-restart listening for more responsive interaction
            setTimeout(() => {
              if (!listening && browserSupportsSpeechRecognition) {
                SpeechRecognition.startListening({
                  continuous: true,
                  language: 'en-US',
                  interimResults: true
                });
                setAwaitingMoreQuestion(true);
              }
            }, 200);
          } catch (error) {
            console.error("TTS Error:", error);
          }
        }
      } else if (result.type.startsWith("CHART")) {
        if (result.type === "CHART_MAP") setCurrentMapDisplayMode("india");
        const parsedData =
          typeof result.data === "string" ? JSON.parse(result.data) : result.data;
        updateChartList({
          type: result.type,
          data: parsedData,
          timestamp: replyTimestamp,
        });
        // Auto-restart listening for chart responses
        setTimeout(() => {
          if (!listening && browserSupportsSpeechRecognition) {
            SpeechRecognition.startListening({
              continuous: true,
              language: 'en-US',
              interimResults: true
            });
            setAwaitingMoreQuestion(true);
          }
        }, 200);
      }
    } catch (err) {
      setLoading(false);
      updateChartList({
        type: "error",
        data: "❌ Server busy or network error. Please try again.",
        timestamp: new Date().toISOString(),
      });
      try {
        await speakWithIsolation("Server busy or network error. Please try again.");
      } catch (error) {
        console.error("TTS Error:", error);
      }
    }
  };

  const updateChartList = (newItem: ChartDataItem) => {
    setChartDataList((prev) => {
      const updated = [...prev, newItem].slice(-20);
      localStorage.setItem("chartDataList", JSON.stringify(updated));
      return updated;
    });
  };

  const handleSend = (inputText?: string) => {
    const textToSend = inputText !== undefined ? inputText : userInput;
    if (textToSend.trim()) {
      const timestamp = new Date().toISOString();
      const newUserMessage: ChartDataItem = { type: "user", data: textToSend.trim(), timestamp };
      updateChartList(newUserMessage);
      fetchReportData(textToSend.trim());
      setUserInput("");
      resetTranscript();
    }
  };

  const handleClearChat = () => {
    setChartDataList([]);
    localStorage.removeItem("chartDataList");
    leafletMapRefs.current.forEach((map) => map.remove());
    leafletMapRefs.current.clear();
    leafletMarkersRefs.current.clear();
    chartJsInstances.current.forEach((chart) => chart.destroy());
    chartJsInstances.current.clear();
    setCurrentMapDisplayMode("india");
    setShowOptionsDropdown(false);
  };

  const renderLeafletMarkers = (map: L.Map, warehouseData: any[], mapIndex: number) => {
    const currentMarkers = leafletMarkersRefs.current.get(mapIndex) || [];
    currentMarkers.forEach((m) => map.removeLayer(m));
    const newMarkers: L.CircleMarker[] = [];
    const validLatLngs: L.LatLng[] = [];
    const filtered = warehouseData.filter((d) => {
      const lat = d.value?.latitude;
      const lng = d.value?.longitude;
      return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng);
    });
    filtered.forEach((w) => {
      const latLng = L.latLng(w.value.latitude, w.value.longitude);
      const marker = L.circleMarker(latLng, {
        radius: 8,
        fillColor: "red",
        color: "white",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);
      marker.bindPopup(`<div><strong>${w.label}</strong><br>Lat: ${w.value.latitude.toFixed(2)}, Lng: ${w.value.longitude.toFixed(2)}</div>`);
      marker.on("mouseover", () => marker.openPopup());
      marker.on("mouseout", () => marker.closePopup());
      newMarkers.push(marker);
      validLatLngs.push(latLng);
    });
    leafletMarkersRefs.current.set(mapIndex, newMarkers);
    return validLatLngs;
  };

  const handleToggleMapMode = (mapIndex: number, warehouseData: any[]) => {
    const map = leafletMapRefs.current.get(mapIndex);
    if (!map) return;
    const newMode = currentMapDisplayMode === "world" ? "india" : "world";
    setCurrentMapDisplayMode(newMode);
    const latLngs = renderLeafletMarkers(map, warehouseData, mapIndex);
    if (newMode === "india") map.setView([20.5937, 78.9629], 5);
    else if (latLngs.length > 0) map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
    else map.setView([0, 0], 2);
    map.invalidateSize();
  };

  const renderChartJsChart = (canvasElement: HTMLCanvasElement, data: any[], chartType: string, index: number, timestamp: string) => {
    if (chartJsInstances.current.has(index)) {
      chartJsInstances.current.get(index)?.destroy();
      chartJsInstances.current.delete(index);
    }
    const formattedDateForChartTitle = formatTimestampForDisplay(timestamp, "dateOnly");
    const colorPalette = [
      "#3b82f6", "#f97316", "#14b8a6", "#ef4444", "#8b5cf6", "#eab308", "#6b7280",
      "#ec4899", "#10b981", "#f59e0b", "#6366f1", "#84cc16", "#06b6d4", "#f43f5e"
    ];
    const borderPalette = [
      "#2563eb", "#c2410c", "#0d9488", "#dc2626", "#7c3aed", "#d97706", "#4b5563",
      "#db2777", "#059669", "#d97706", "#4f46e5", "#65a30d", "#0891b2", "#e11d48"
    ];
    const fixedBarThickness = 40;
    const fixedPointRadius = 4;

    let chartConfig: Chart.ChartConfiguration = {
      type: chartType as any,
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { 
            position: "bottom", 
            display: true,
            labels: {
              boxWidth: 12,
              padding: 15,
              font: {
                size: 11
              }
            }
          },
          title: {
            display: true,
            text: `${chartType.toUpperCase()} Chart (${formattedDateForChartTitle})`,
            font: { size: 16, weight: 'bold' }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (chartType === "pie" || chartType === "doughnut") {
                  const label = ctx.label || "";
                  const value = ctx.parsed;
                  const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
                  const percent = ((value / total) * 100).toFixed(1);
                  return `${label}: ${value} (${percent}%)`;
                }
                const label = ctx.dataset.label || "";
                let value = ctx.parsed?.y ?? ctx.parsed ?? "";
                return label ? `${label}: ${value}` : `${value}`;
              },
            },
          },
        },
        scales: chartType === "pie" || chartType === "doughnut" ? {} : {
          x: { 
            stacked: false, 
            display: true,
            grid: {
              display: false
            },
            ticks: {
              maxRotation: 45,
              minRotation: 0
            }
          },
          y: { 
            stacked: false, 
            beginAtZero: true, 
            display: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.1)'
            }
          },
        },
      },
    };

    const ctx = canvasElement.getContext("2d");
    if (!ctx) return;

    // Handle pie and doughnut charts
    if (chartType === "pie" || chartType === "doughnut") {
      const labels = data.map((d) => d.label || d.name || "");
      const values = data.map((d) => d.value || 0);
      
      chartConfig.data = {
        labels,
        datasets: [{
          label: "Values",
          data: values,
          backgroundColor: colorPalette,
          borderColor: borderPalette.map(color => color + "CC"),
          borderWidth: 2,
          // Enable leader lines for external labels
          datalabels: {
            anchor: 'end',
            align: 'end',
            offset: 15,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#e0e0e0',
            borderRadius: 4,
            borderWidth: 1,
            color: '#333',
            font: {
              size: 11,
              weight: 'bold'
            },
            padding: 6,
            clip: false
          }
        }],
      };
      
            // Enhanced options for pie charts with external labels
      chartConfig.options = {
        ...chartConfig.options,
        layout: {
          padding: {
            top: 40,
            bottom: 40,
            left: 40,
            right: 40
          }
        },
        elements: {
          arc: {
            borderWidth: 2,
            hoverBorderWidth: 3
          },
          line: {
            borderWidth: 2,
            tension: 0
          }
        },
        plugins: {
          ...chartConfig.options.plugins,
          legend: {
            position: "bottom",
            display: true,
            labels: {
              boxWidth: 15,
              padding: 15,
              font: {
                size: 12
              },
              generateLabels: (chart) => {
                const data = chart.data;
                if (data.labels && data.labels.length && data.datasets.length) {
                  const dataset = data.datasets[0];
                  return data.labels.map((label, i) => {
                    return {
                      text: `${label}`,
                      fillStyle: (dataset.backgroundColor as string[])[i],
                      strokeStyle: (dataset.borderColor as string[])[i],
                      lineWidth: dataset.borderWidth as number,
                      hidden: false,
                      index: i
                    };
                  });
                }
                return [];
              }
            }
          },
          datalabels: {
            display: true,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#e0e0e0',
            borderRadius: 4,
            borderWidth: 1,
            color: '#333',
            font: {
              size: 11,
              weight: 'bold'
            },
            padding: 6,
            formatter: function(value, context) {
              const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
              const percent = ((value / total) * 100).toFixed(1);
              const label = context.chart.data.labels[context.dataIndex];
              return `${label}\n${value} (${percent}%)`;
            },
            anchor: 'end',
            align: 'end',
            offset: 15,
            clip: false,
            // Configure leader lines with slice colors
            textStrokeColor: function(context) {
              return context.dataset.backgroundColor[context.dataIndex];
            },
            textStrokeWidth: 0,
            // Leader line configuration
            listeners: {
              afterDraw: function(chart, args, options) {
                const ctx = chart.ctx;
                const dataset = chart.data.datasets[0];
                const meta = chart.getDatasetMeta(0);
                
                ctx.save();
                
                meta.data.forEach((arc, index) => {
                  const color = dataset.backgroundColor[index];
                  const model = arc;
                  const startAngle = model.startAngle;
                  const endAngle = model.endAngle;
                  const midAngle = startAngle + (endAngle - startAngle) / 2;
                  
                  const x = model.x;
                  const y = model.y;
                  const outerRadius = model.outerRadius;
                  const innerRadius = model.innerRadius;
                  
                  // Calculate line start point (edge of slice)
                  const lineStartX = x + Math.cos(midAngle) * outerRadius;
                  const lineStartY = y + Math.sin(midAngle) * outerRadius;
                  
                  // Calculate line end point (further out for label)
                  const lineEndX = x + Math.cos(midAngle) * (outerRadius + 20);
                  const lineEndY = y + Math.sin(midAngle) * (outerRadius + 20);
                  
                  // Draw the connecting line with slice color
                  ctx.beginPath();
                  ctx.strokeStyle = color;
                  ctx.lineWidth = 2;
                  ctx.moveTo(lineStartX, lineStartY);
                  ctx.lineTo(lineEndX, lineEndY);
                  ctx.stroke();
                });
                
                ctx.restore();
              }
            }
          }
        }
      };
    } else {
      // Handle other chart types (existing logic)
      const isStackedData = data.length > 0 && "stack" in data[0];

      if ((chartType === "bar" || chartType === "line") && isStackedData) {
        const labels = Array.from(new Set(data.map((d) => d.label)));
        const stacks = Array.from(new Set(data.map((d) => d.stack)));
        const datasets = stacks.map((stackName, idx) => ({
          label: stackName,
          data: labels.map((label) => {
            const item = data.find((d) => d.label === label && d.stack === stackName);
            return item ? item.value : 0;
          }),
          backgroundColor: colorPalette[idx % colorPalette.length],
          borderColor: borderPalette[idx % borderPalette.length],
          borderWidth: 1,
          ...(chartType === "bar"
            ? {
              barThickness: fixedBarThickness,
              maxBarThickness: fixedBarThickness,
              barPercentage: 0.8,
              categoryPercentage: 0.9,
            }
            : {
              fill: false,
              pointRadius: fixedPointRadius,
              borderWidth: 2,
              tension: 0.3,
            }),
        }));
        chartConfig.data = { labels, datasets };
        // Change from stacked to grouped bars - set stacked to false
        chartConfig.options.scales!.x!.stacked = false;
        chartConfig.options.scales!.y!.stacked = false;
      } else if (chartType === "bar") {
        const labelKey = data[0]?.name ? "name" : "label";
        const labels = data.map((d) => d[labelKey]);
        const numericKeys = Object.keys(data[0]).filter(
          (k) => k !== labelKey && typeof data[0][k] === "number"
        );
        const datasets = numericKeys.map((key, idx) => ({
          label: key,
          data: labels.map((l) => {
            const item = data.find((d) => d[labelKey] === l);
            return item ? item[key] || 0 : 0;
          }),
          backgroundColor: colorPalette[idx % colorPalette.length],
          borderColor: borderPalette[idx % borderPalette.length],
          borderWidth: 1,
          barThickness: fixedBarThickness,
          maxBarThickness: fixedBarThickness,
          barPercentage: 0.8,
          categoryPercentage: 0.9,
        }));
        chartConfig.data = { labels, datasets };
        // Ensure bars are grouped, not stacked
        chartConfig.options.scales!.x!.stacked = false;
        chartConfig.options.scales!.y!.stacked = false;
      } else if (chartType === "line") {
        const labels = data.map((d) => d.label || d.name || "");
        const values = data.map((d) => d.value || 0);
        chartConfig.data = {
          labels,
          datasets: [
            {
              label: "Values",
              data: values,
              borderColor: borderPalette[0],
              backgroundColor: colorPalette[0] + "88",
              fill: false,
              pointRadius: fixedPointRadius,
              borderWidth: 2,
              tension: 0.3,
            },
          ],
        };
      }
    }

      const newChart = new Chart(ctx, chartConfig);
  chartJsInstances.current.set(index, newChart);
};

const handleDownloadChart = (index: number) => {
  if (chartJsInstances.current.has(index)) {
    const chartInstance = chartJsInstances.current.get(index);
    if (chartInstance) {
      const canvas = chartInstance.canvas;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `chart_${index + 1}_${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
  setShowOptionsDropdown(false);
};

const handleDownloadMap = (index: number) => {
  const mapInstance = leafletMapRefs.current.get(index);
  if (!mapInstance) {
    showToast("Map not found for download.");
    return;
  }
  leafletImage(mapInstance, function (err, canvas) {
    if (err) {
      showToast("Failed to capture map image.");
      return;
    }
    const imgData = canvas.toDataURL("image/jpeg", 0.9);
    const link = document.createElement("a");
    link.href = imgData;
    link.download = `map_${index + 1}_${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
  setShowOptionsDropdown(false);
};

  // Effects
  useEffect(() => {
    chartDataList.forEach((item, index) => {
      if (item.type.startsWith("CHART_")) {
        const rawType = item.type.replace("CHART_", "").toLowerCase();

        // Handle pie charts properly
        if (rawType === "pie" || rawType === "doughnut") {
          const canvasId = `chart-canvas-${index}`;
          const canvasElement = document.getElementById(canvasId) as HTMLCanvasElement | null;
          if (canvasElement)
            renderChartJsChart(canvasElement, item.data, rawType, index, item.timestamp);
          return;
        }

        const chartType =
          ["stackedbar"].includes(rawType)
            ? "bar"
            : ["stackedline"].includes(rawType)
              ? "line"
              : rawType;
        const canvasId = `chart-canvas-${index}`;
        const canvasElement = document.getElementById(canvasId) as HTMLCanvasElement | null;
        if (canvasElement)
          renderChartJsChart(canvasElement, item.data, chartType, index, item.timestamp);
      }
      if (item.type === "CHART_MAP") {
        const mapContainerId = `map-container-${index}`;
        const mapContainerElement = document.getElementById(mapContainerId);
        if (mapContainerElement) {
          let mapInstance = leafletMapRefs.current.get(index);
          if (!mapInstance) {
            mapInstance = L.map(mapContainerElement, { zoomControl: true, attributionControl: false });
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution:
                "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
            }).addTo(mapInstance);
            leafletMapRefs.current.set(index, mapInstance);
          }
          mapInstance.invalidateSize();
          const latLngs = renderLeafletMarkers(mapInstance, item.data, index);
          if (currentMapDisplayMode === "india") mapInstance.setView([20.5937, 78.9629], 5);
          else if (latLngs.length > 0) mapInstance.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
          else mapInstance.setView([0, 0], 2);
        }
      }
    });

    const currentIndices = new Set(chartDataList.map((_, i) => i));
    chartJsInstances.current.forEach((chart, index) => {
      if (!currentIndices.has(index)) {
        chart.destroy();
        chartJsInstances.current.delete(index);
      }
    });
    leafletMapRefs.current.forEach((map, index) => {
      if (!currentIndices.has(index)) {
        map.remove();
        leafletMapRefs.current.delete(index);
        leafletMarkersRefs.current.delete(index);
      }
    });

    return () => {
      chartJsInstances.current.forEach((chart) => chart.destroy());
      chartJsInstances.current.clear();
      leafletMapRefs.current.forEach((map) => map.remove());
      leafletMapRefs.current.clear();
      leafletMarkersRefs.current.clear();
    };
  }, [chartDataList, currentMapDisplayMode]);

  useEffect(() => {
    if (chatMessagesEndRef.current)
      chatMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chartDataList]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        optionsDropdownRef.current &&
        !optionsDropdownRef.current.contains(event.target as Node)
      ) {
        setShowOptionsDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  let lastDisplayedDate: string | null = null;

  return (
    <div className="relative flex flex-col min-h-screen bg-white dark:bg-gray-900 text-black dark:text-white font-inter">
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto pb-28">
        <div className="w-full max-w-5xl mx-auto space-y-4" ref={chatContainerRef}>
          {chartDataList.map((item, index) => {
            const currentDate = formatTimestampForDisplay(item.timestamp, "dateOnly");
            const showDateHeader = lastDisplayedDate !== currentDate;
            const isEmptyData =
              item.data == null ||
              (Array.isArray(item.data) && item.data.length === 0) ||
              (typeof item.data === "object" && !Array.isArray(item.data) && Object.keys(item.data).length === 0);

            if (item.type === "text" && isEmptyData) {
              return (
                <React.Fragment key={index}>
                  {showDateHeader && (
                    <div className="w-full flex justify-center my-3">
                      <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                        {currentDate}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-start w-full">
                    <div className="flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto">
                      <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                        Bot🤖
                      </div>
                      <div className="pb-4 break-words">Please ask question again.</div>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            if (item.type.startsWith("CHART_") && isEmptyData) {
              return (
                <React.Fragment key={index}>
                  {showDateHeader && (
                    <div className="w-full flex justify-center my-3">
                      <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                        {currentDate}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-start w-full">
                    <div className="flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto">
                      <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                        Bot🤖
                      </div>
                      <div className="pb-4 break-words">No chart/map data available.</div>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            if (showDateHeader) lastDisplayedDate = currentDate;

            let messageContent = null;
            let messageCardClass = "";
            const alignment = item.type === "user" ? "justify-end" : "justify-start";
            const formattedTime = formatTimestampForDisplay(item.timestamp, "timeOnly");

            if (item.type === "user") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 relative";
              messageContent = (
                <>
                  <div className="font-semibold text-xs mb-1 text-black dark:text-white">You</div>
                  <div className="text-black dark:text-white pb-4 break-words">{String(item.data)}</div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "text") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto";
              messageContent = (
                <>
                  <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                    Bot🤖
                  </div>
                  <div className="pb-4 break-words">
                    <pre className="whitespace-pre-wrap">{String(item.data)}</pre>
                  </div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "error") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-red-100 text-red-700 relative mr-auto";
              messageContent = (
                <>
                  <div className="pb-4 break-words">{String(item.data)}</div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "CHART_MAP") {
              messageCardClass =
                "relative w-full h-[calc(100vh-250px)] min-h-[400px] bg-white dark:bg-gray-700 rounded-xl shadow p-2 flex flex-col";
              messageContent = (
                <>
                  <div
                    id={`map-container-${index}`}
                    style={{ width: "100%", height: "100%" }}
                    className="overflow-hidden rounded-lg"
                  />
                  <div className="map-overlay-controls">
                    <Button
                      onClick={() => handleToggleMapMode(index, item.data)}
                      className="bg-blue-600 text-white hover:bg-blue-700 rounded-full p-2 text-xs flex items-center gap-1 shadow-md"
                      title={
                        currentMapDisplayMode === "world"
                          ? "Zoom In to India"
                          : "Zoom Out to World"
                      }
                    >
                      {currentMapDisplayMode === "world" ? (
                        <MapPin className="w-3 h-3" />
                      ) : (
                        <Globe className="w-3 h-3" />
                      )}
                      {currentMapDisplayMode === "world"
                        ? "Zoom In to India"
                        : "Zoom Out to World"}
                    </Button>
                    <Button
                      onClick={() => handleDownloadMap(index)}
                      className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                      title={`Download Map ${index + 1}`}
                      aria-label={`Download Map ${index + 1}`}
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                    <Button
                      onClick={() => handleShareMap(index)}
                      className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                      title={`Share Map ${index + 1}`}
                      aria-label={`Share Map ${index + 1}`}
                    >
                      <Share2 className="w-5 h-5" />
                    </Button>
                  </div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                  </div>
                  <style>{`
                    #map-container-${index} {
                      position: relative;
                      padding-top: 40px;
                      height: 100%;
                      width: 100%;
                    }
                    .map-overlay-controls {
                      position: absolute;
                      top: 8px;
                      right: 8px;
                      z-index: 1200;
                      display: flex;
                      gap: 8px;
                    }
                    .leaflet-control {
                      z-index: 1100 !important;
                    }
                  `}</style>
                </>
              );
            } else if (item.type.startsWith("CHART_")) {
              const rawType = item.type.replace("CHART_", "").toLowerCase();

              // Handle all chart types with the same container structure
              return (
                <React.Fragment key={index}>
                  {showDateHeader && (
                    <div className="w-full flex justify-center my-3">
                      <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                        {currentDate}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-start w-full">
                    <ChartContainer 
                      dataLength={item.data.length} 
                      className="relative"
                      height={rawType === "pie" || rawType === "doughnut" ? "650px" : "500px"}
                    >
                      <canvas
                        id={`chart-canvas-${index}`}
                        className="h-full w-full"
                      />
                      <Button
                        variant="ghost"
                        onClick={() => handleDownloadChart(index)}
                        className="absolute top-2 right-2 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                        title={`Download Chart ${index + 1}`}
                        aria-label={`Download Chart ${index + 1}`}
                      >
                        <Download className="w-5 h-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleShareChart(index)}
                        className="absolute top-2 right-12 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                        title={`Share Chart ${index + 1}`}
                        aria-label={`Share Chart ${index + 1}`}
                      >
                        <Share2 className="w-5 h-5" />
                      </Button>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap z-10">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </ChartContainer>
                  </div>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={index}>
                {showDateHeader && (
                  <div className="w-full flex justify-center my-3">
                    <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                      {currentDate}
                    </div>
                  </div>
                )}
                <div className={`flex ${alignment} w-full`}>
                  <div className={messageCardClass}>{messageContent}</div>
                </div>
              </React.Fragment>
            );
          })}
          <div ref={chatMessagesEndRef} />
        </div>
      </div>

      <div className="fixed bottom-0 right-0 left-[224px] bg-white dark:bg-gray-900 py-3 px-4 z-20 shadow-lg">
        <div
          className={`mx-auto max-w-5xl flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-2 shadow-md transition-colors border ${inputFocused ? "border-blue-600" : "border-transparent"
            }`}
          style={{ gap: "8px" }}
          onClick={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          tabIndex={-1}
        >
          <button
            onClick={handleVoiceButtonClick}
            aria-pressed={listening}
            aria-label={listening ? "Stop Voice Input" : "Start Voice Input"}
            className={`relative rounded-full w-11 h-11 flex items-center justify-center transition-colors focus:outline-none focus:ring-4 focus:ring-blue-500 ${listening ? "bg-blue-700 text-white ring-4 ring-blue-300 animate-pulse" : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              className="w-7 h-7"
            >
              <path d="M12 14C13.654 14 15 12.654 15 11V5C15 3.346 13.654 2 12 2C10.346 2 9 3.346 9 5V11C9 12.654 10.346 14 12 14Z" />
              <path d="M19 11C19 14.3137 16.3137 17 13 17H11C7.68629 17 5 14.3137 5 11H7C7 13.2091 8.79086 15 11 15H13C15.2091 15 17 13.2091 17 11H19Z" />
              <rect x="11" y="18" width="2" height="4" rx="1" />
            </svg>
          </button>

          <input
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-base px-4 py-3 text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            placeholder="What would you analyze?"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            aria-label="Ask a report question"
          />

          <div className="relative" ref={optionsDropdownRef}>
            <Button
              variant="ghost"
              onClick={() => setShowOptionsDropdown(!showOptionsDropdown)}
              className="p-3 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="More options"
              aria-haspopup="true"
              aria-expanded={showOptionsDropdown}
            >
              <MoreVertical className="w-6 h-6" />
            </Button>
            {showOptionsDropdown && (
              <div
                style={{ position: "absolute", right: 0, bottom: "100%", marginBottom: "0.5rem", zIndex: 40, width: "11rem" }}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 animate-fade-in-up"
              >
                <button
                  onClick={handleUploadFile}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <Paperclip className="w-4 h-4" /> Upload File
                </button>
                <button
                  onClick={handleUploadPhoto}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <ImageIcon className="w-4 h-4" /> Upload Photo
                </button>
                <button
                  onClick={handleClearChat}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-100 dark:hover:bg-red-700 dark:text-red-400 whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" /> Clear Chat History
                </button>
              </div>
            )}
          </div>

          <Button
            onClick={() => handleSend()}
            className="rounded-full p-3 bg-blue-600 text-white hover:bg-blue-700 shadow-md"
            disabled={loading || !userInput.trim()}
            title="Send question"
            aria-label="Send question"
          >
            <SendHorizonal className="w-5 h-5" />
          </Button>
        </div>
        {loading && (
          <div className="absolute -top-6 left-0 right-0 text-sm text-blue-600 animate-pulse text-center">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportDashboard;