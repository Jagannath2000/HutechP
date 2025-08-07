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

// Helper to speak text using ElevenLabs API with voice isolation
const playElevenLabsTTS = async (text: string) => {
  try {
    // Stop listening during TTS to prevent feedback
    if (SpeechRecognition) {
      SpeechRecognition.stopListening();
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
    
    // Wait for TTS to finish before re-enabling speech recognition
    await audio.play();
    
    return new Promise((resolve) => {
      audio.onended = () => {
        // Small delay after TTS ends before re-enabling speech recognition
        setTimeout(() => {
          resolve(undefined);
        }, 500);
      };
    });
  } catch (err) {
    console.error("ElevenLabs TTS error:", err);
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

const ChartContainer: React.FC<{ children: React.ReactNode; dataLength: number; className?: string }> = ({
  children,
  dataLength,
  className = "",
}) => {
  const itemWidth = 80;
  const minWidth = dataLength * itemWidth;
  return (
    <div
      className={`overflow-x-auto w-full h-[500px] bg-white dark:bg-gray-700 rounded-lg border p-2 flex flex-col relative ${className}`}
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

  const debouncedSpeech = useDebounce<string>(transcript, 1500);

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
            interimResults: false
          });
          setAwaitingMoreQuestion(true);
        }
      }, 1000);
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

  // Enhanced speech recognition effect with better voice isolation
  useEffect(() => {
    if (listening && debouncedSpeech.trim() && !isTTSPlaying) {
      const lower = debouncedSpeech.trim().toLowerCase();

      // Check for stop commands
      if (awaitingMoreQuestion && ["no", "no more", "no thanks", "that's all", "stop", "bye"].some(cmd => lower.includes(cmd))) {
        speakWithIsolation("Okay, have a great day!");
        SpeechRecognition.stopListening();
        setAwaitingMoreQuestion(false);
        resetTranscript();
        return;
      }

      // Process the speech input only if it's meaningful and TTS is not playing
      if (debouncedSpeech.trim().length > 2) {
        handleSend(debouncedSpeech.trim());
        resetTranscript();
      }
    }
  }, [debouncedSpeech, listening, awaitingMoreQuestion, isTTSPlaying]);

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
            if (listening) {
              setAwaitingMoreQuestion(true);
              await speakWithIsolation("Do you have any other questions?");
            }
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
        if (listening) {
          setAwaitingMoreQuestion(true);
          try {
            await speakWithIsolation("Do you have any other questions?");
          } catch (error) {
            console.error("TTS Error:", error);
          }
        }
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
            position: chartType === "pie" || chartType === "doughnut" ? "right" : "bottom", 
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
          x: { stacked: false, display: true },
          y: { stacked: false, beginAtZero: true, display: true },
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
        }],
      };
      
      // Enhanced options for pie charts
      chartConfig.options = {
        ...chartConfig.options,
        plugins: {
          ...chartConfig.options.plugins,
          legend: {
            position: "right",
            display: true,
            labels: {
              boxWidth: 12,
              padding: 10,
              font: {
                size: 10
              },
              generateLabels: (chart) => {
                const data = chart.data;
                if (data.labels && data.labels.length && data.datasets.length) {
                  const dataset = data.datasets[0];
                  const total = dataset.data.reduce((a: number, b: number) => a + b, 0);
                  return data.labels.map((label, i) => {
                    const value = dataset.data[i] as number;
                    const percent = ((value / total) * 100).toFixed(1);
                    return {
                      text: `${label}: ${value} (${percent}%)`,
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
              barPercentage: 0.7,
              categoryPercentage: 0.8,
            }
            : {
              fill: false,
              pointRadius: fixedPointRadius,
              borderWidth: 2,
              tension: 0.3,
            }),
        }));
        chartConfig.data = { labels, datasets };
        chartConfig.options.scales!.x!.stacked = true;
        chartConfig.options.scales!.y!.stacked = true;
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
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        }));
        chartConfig.data = { labels, datasets };
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-4 bg-white dark:bg-gray-800 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
          Report Dashboard
        </h1>
        <div className="flex items-center space-x-2">
          <Button onClick={handleVoiceButtonClick} variant="ghost" className="p-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-mic"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 1 0 6 0V4a3 3 0 0 0-3-3" />
            </svg>
          </Button>
          <Button onClick={handleUploadFile} variant="ghost" className="p-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-upload"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M17 19l-2 2-2-2" />
            </svg>
          </Button>
          <Button onClick={handleUploadPhoto} variant="ghost" className="p-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-image"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </Button>
          <Button onClick={handleClearChat} variant="ghost" className="p-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-trash-2"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M3 6V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <ChartContainer dataLength={chartDataList.length}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Chat History
              </h3>
              <Button onClick={() => setShowOptionsDropdown(!showOptionsDropdown)} variant="ghost" className="p-2">
                <MoreVertical className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </Button>
            </div>
            {showOptionsDropdown && (
              <div ref={optionsDropdownRef} className="absolute top-full mt-2 w-48 bg-white dark:bg-gray-700 rounded-md shadow-lg z-10">
                <button onClick={handleClearChat} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-t-md">
                  Clear Chat
                </button>
                <button onClick={() => {
                  const pdf = new jsPDF();
                  const chatContent = document.getElementById("chat-content");
                  if (chatContent) {
                    html2canvas(chatContent, { scale: 2 }).then(canvas => {
                      const imgData = canvas.toDataURL('image/png');
                      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297); // A4 size
                      pdf.save('chat_history.pdf');
                    });
                  }
                }} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-b-md">
                  Download Chat
                </button>
              </div>
            )}
            <div id="chat-content" className="flex flex-col-reverse overflow-y-auto pr-2">
              {chartDataList.map((item, index) => (
                <div key={index} className="flex justify-end mb-2">
                  <div className="bg-blue-600 text-white p-2 rounded-lg max-w-[80%]">
                    <p className="text-sm">{item.data}</p>
                    <p className="text-xs text-gray-300">{formatTimestampForDisplay(item.timestamp, "timeOnly")}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-end mb-2">
                  <div className="bg-gray-200 text-gray-800 p-2 rounded-lg max-w-[80%]">
                    <p className="text-sm">Thinking...</p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end mt-2">
              <input
                type="text"
                placeholder="Type your message..."
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleSend();
                  }
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                className="flex-1 p-2 rounded-full bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              <Button onClick={() => handleSend()} variant="ghost" className="p-2">
                <SendHorizonal className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </Button>
            </div>
          </ChartContainer>

          <ChartContainer dataLength={chartDataList.length}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Charts
              </h3>
              <Button onClick={() => setShowOptionsDropdown(!showOptionsDropdown)} variant="ghost" className="p-2">
                <MoreVertical className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </Button>
            </div>
            {showOptionsDropdown && (
              <div ref={optionsDropdownRef} className="absolute top-full mt-2 w-48 bg-white dark:bg-gray-700 rounded-md shadow-lg z-10">
                <button onClick={() => handleClearChat()} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-t-md">
                  Clear Charts
                </button>
                <button onClick={() => {
                  const pdf = new jsPDF();
                  const chartContent = document.getElementById("chart-content");
                  if (chartContent) {
                    html2canvas(chartContent, { scale: 2 }).then(canvas => {
                      const imgData = canvas.toDataURL('image/png');
                      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297); // A4 size
                      pdf.save('charts.pdf');
                    });
                  }
                }} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-b-md">
                  Download Charts
                </button>
              </div>
            )}
            <div id="chart-content" className="overflow-y-auto pr-2">
              {chartDataList.map((item, index) => (
                <div key={index} className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-md font-medium text-gray-800 dark:text-gray-200">
                      {item.type.replace("CHART_", "")}
                    </h4>
                    <div className="flex space-x-1">
                      <Button onClick={() => handleShareChart(index)} variant="ghost" className="p-1">
                        <Share2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </Button>
                      <Button onClick={() => handleShareMap(index)} variant="ghost" className="p-1">
                        <Globe className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </Button>
                      <Button onClick={() => handleClearChart()} variant="ghost" className="p-1">
                        <Trash2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </Button>
                    </div>
                  </div>
                  {item.type === "CHART_MAP" ? (
                    <div className="w-full h-full">
                      <L.Map
                        ref={(el) => {
                          if (el) {
                            leafletMapRefs.current.set(index, L.map(el, {
                              center: [20.5937, 78.9629], // Default to India
                              zoom: 5,
                              zoomControl: false,
                              attributionControl: false,
                              minZoom: 2,
                              maxZoom: 18,
                            }));
                            const map = leafletMapRefs.current.get(index);
                            if (map) {
                              map.on("moveend", () => {
                                if (currentMapDisplayMode === "india") {
                                  map.setView([20.5937, 78.9629], 5);
                                } else {
                                  const latLngs = renderLeafletMarkers(map, item.data, index);
                                  if (latLngs.length > 0) {
                                    map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
                                  } else {
                                    map.setView([0, 0], 2);
                                  }
                                }
                              });
                              map.on("zoomend", () => {
                                if (currentMapDisplayMode === "india") {
                                  map.setView([20.5937, 78.9629], 5);
                                } else {
                                  const latLngs = renderLeafletMarkers(map, item.data, index);
                                  if (latLngs.length > 0) {
                                    map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
                                  } else {
                                    map.setView([0, 0], 2);
                                  }
                                }
                              });
                              map.on("resize", () => {
                                if (currentMapDisplayMode === "india") {
                                  map.setView([20.5937, 78.9629], 5);
                                } else {
                                  const latLngs = renderLeafletMarkers(map, item.data, index);
                                  if (latLngs.length > 0) {
                                    map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
                                  } else {
                                    map.setView([0, 0], 2);
                                  }
                                }
                              });
                              map.on("load", () => {
                                if (currentMapDisplayMode === "india") {
                                  map.setView([20.5937, 78.9629], 5);
                                } else {
                                  const latLngs = renderLeafletMarkers(map, item.data, index);
                                  if (latLngs.length > 0) {
                                    map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
                                  } else {
                                    map.setView([0, 0], 2);
                                  }
                                }
                              });
                            }
                          }
                        }}
                        className="w-full h-full"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full">
                      <canvas
                        ref={(el) => {
                          if (el) {
                            renderChartJsChart(el, item.data, item.type.replace("CHART_", ""), index, item.timestamp);
                          }
                        }}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ChartContainer>
        </div>
      </div>
    </div>
  );
};

export default ReportDashboard;