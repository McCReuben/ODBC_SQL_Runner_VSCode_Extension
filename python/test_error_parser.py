#!/usr/bin/env python3
"""
Test the SparkErrorParser with real error examples
"""

import sys
import os

# Add the parent directory to the path so we can import sql_executor
sys.path.insert(0, os.path.dirname(__file__))

from sql_executor import SparkErrorParser
from Errors import errors

def test_error_parser():
    """Test the error parser with real Spark errors"""
    print("Testing Spark Error Parser")
    print("=" * 80)
    
    for i, error_str in enumerate(errors, 1):
        print(f"\n{'='*80}")
        print(f"Test Case {i}")
        print(f"{'='*80}")
        
        # Parse the error
        message, error_type, details = SparkErrorParser.parse_error(error_str)
        
        print(f"\n✓ Error Type: {error_type}")
        print(f"✓ User Message:\n{message}")
        
        if details:
            print(f"\n✓ Details:")
            for key, value in details.items():
                if isinstance(value, list):
                    print(f"  - {key}: {', '.join(value)}")
                else:
                    print(f"  - {key}: {value}")
        
        print(f"\n{'='*80}\n")

if __name__ == "__main__":
    test_error_parser()
