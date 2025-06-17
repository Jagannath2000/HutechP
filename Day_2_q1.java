package Hutech;

import java.util.Scanner;

public class Day_2_q1 {
    //Write a Program to Print Pyramid Number Pattern in Java.

    public static void main(String[] args) {

        Scanner sc = new Scanner(System.in);
        System.out.println("Enter how many lines do you want : ");
        int ln = sc.nextInt();

        for(int i=1;i<=ln;i++){
            for(int k=i ;k<=ln;k++){
                System.out.print(" ");
            }
           for(int j=1;j<=i;j++){
            System.out.print("* ");
           }
           System.out.println();
        }

    }

    
}