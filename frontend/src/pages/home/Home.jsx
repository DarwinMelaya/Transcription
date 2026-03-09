import { useState } from "react";
import { transcribeAudio } from "../../utils/api";

const Home = () => {
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] ?? null);
    setTranscript("");
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Please choose an audio file first.");
      return;
    }

    setLoading(true);
    setError("");
    setTranscript("");

    try {
      const { transcript: text } = await transcribeAudio(file);
      setTranscript(text || "");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-xl bg-white shadow-md rounded-lg p-6 space-y-4">
        <h1 className="text-2xl font-semibold text-center text-gray-900">
          Audio to Text Transcript
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload audio file
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-900 file:mr-4 file:py-2 file:px-4
                         file:rounded-md file:border-0 file:text-sm file:font-semibold
                         file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
            />
            {file && (
              <p className="mt-1 text-xs text-gray-500">
                Selected: {file.name}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex justify-center items-center px-4 py-2
                       border border-transparent text-sm font-medium rounded-md
                       text-white bg-indigo-600 hover:bg-indigo-700
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Transcribing..." : "Transcribe Audio"}
          </button>
        </form>

        {error && (
          <div className="mt-2 text-sm text-red-600 text-center">{error}</div>
        )}

        {transcript && (
          <div className="mt-4">
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Transcript
            </h2>
            <div className="max-h-72 overflow-y-auto border rounded-md p-3 text-sm text-gray-800 whitespace-pre-wrap bg-gray-50">
              {transcript}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
